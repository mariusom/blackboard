import { createRequire } from "node:module"
import * as fs from "node:fs"
import { type BunPlugin } from "bun"

// Candidate platform packages for @gpuix/native's NAPI-RS addon, keyed by
// `${process.platform}-${process.arch}`. Each package's `main` field points
// directly at the `.node` binary, so `require.resolve(specifier)` returns the
// absolute addon path we embed into the standalone executable.
const NATIVE_ADDON_CANDIDATES: Record<string, readonly string[]> = {
  "darwin-arm64": ["@gpuix/native-darwin-arm64", "@gpuix/native-darwin-universal"],
  "darwin-x64": ["@gpuix/native-darwin-x64", "@gpuix/native-darwin-universal"],
  "linux-x64": ["@gpuix/native-linux-x64-gnu", "@gpuix/native-linux-x64-musl"],
  "linux-arm64": ["@gpuix/native-linux-arm64-gnu", "@gpuix/native-linux-arm64-musl"],
  "win32-x64": ["@gpuix/native-win32-x64-msvc", "@gpuix/native-win32-x64-gnu"],
  "win32-arm64": ["@gpuix/native-win32-arm64-msvc"],
}

function resolveNativeAddonPath(): string {
  const platformKey = `${process.platform}-${process.arch}`
  const candidates = NATIVE_ADDON_CANDIDATES[platformKey]
  if (!candidates) {
    throw new Error(
      `Unsupported platform/arch for @gpuix/native embedded builds: ${platformKey}`,
    )
  }

  // Resolve from @gpuix/native's own module context so the optional peer
  // platform packages are found even with isolated (pnpm) installs.
  const nativeRequire = createRequire(import.meta.resolve("@gpuix/native"))
  const errors: string[] = []
  for (const specifier of candidates) {
    try {
      return nativeRequire.resolve(specifier)
    } catch (error) {
      errors.push(
        `  - ${specifier}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  throw new Error(
    `Could not resolve the @gpuix/native .node addon for ${platformKey}. ` +
      `Tried:\n${errors.join("\n")}\n` +
      `Ensure pnpm installed the matching optional dependency (fresh "pnpm install").`,
  )
}

const addonPath = resolveNativeAddonPath()
console.log(`[gpuix-native-embed] resolved native addon: ${addonPath}`)

const gpuixNativeEmbed: BunPlugin = {
  name: "gpuix-native-embed",
  setup(build) {
    // @gpuix/native/index.js (ESM) hides its bindings behind
    // `createRequire(import.meta.url)` + `require("@gpuix/native-<platform>")`
    // chains, which `bun build --compile` cannot statically analyze, so the
    // `.node` file never gets embedded and the app crashes at startup with
    // "Cannot find native binding". Replace the bare specifier with a virtual
    // module that statically `require`s the absolute addon path instead.
    build.onResolve({ filter: /^@gpuix\/native$/ }, () => ({
      path: "@gpuix/native",
      namespace: "gpuix-native-embed",
    }))
    build.onLoad({ filter: /.*/, namespace: "gpuix-native-embed" }, () => ({
      contents: [
        `const nativeBinding = require(${JSON.stringify(addonPath)});`,
        `export const { AvailableUpdate, GpuixRenderer, TestGpuixRenderer, checkUpdate, hasTestGpuixRenderer } = nativeBinding;`,
        `export const __napiBindingTarget = "native";`,
        `export default nativeBinding;`,
      ].join("\n"),
      loader: "js",
      resolveDir: process.cwd(),
    }))
  },
}

const result = await Bun.build({
  entrypoints: ["src/main.tsx"],
  compile: {
    outfile: "dist/blackboard",
  },
  plugins: [gpuixNativeEmbed],
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  throw new Error("Bun.build({ compile }) failed")
}

const outfile = "dist/blackboard"
const sizeMb = (fs.statSync(outfile).size / (1024 * 1024)).toFixed(1)
console.log(`[gpuix-native-embed] built ${outfile} (${sizeMb} MB) with embedded addon`)
