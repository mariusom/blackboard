import { defineConfig, type Plugin } from "vitest/config"

/**
 * `src/workspace/server.ts` imports its HTML and CSS with Bun's text loader
 * (`with { type: "text" }`), which the production Bun build understands but
 * Vite does not. Rewrite those imports to Vite's `?raw` form for tests only;
 * the source keeps the Bun syntax the app ships with.
 */
const textAssets: Plugin = {
  name: "blackboard-text-assets",
  enforce: "pre",
  transform(code, id) {
    if (!id.endsWith(".ts") || !code.includes('with { type: "text" }')) return null
    const rewritten = code.replace(
      /import\s+(\w+)\s+from\s+"([^"]+\.(?:html|css))"[ \t]*with[ \t]*\{[ \t]*type:[ \t]*"text"[ \t]*\}/g,
      'import $1 from "$2?raw"',
    )
    return rewritten === code ? null : { code: rewritten, map: null }
  },
}

/**
 * The workspace server builds its browser bundle with `Bun.build` and serves
 * it with `Bun.serve`, so the suite runs vitest under Bun
 * (`bun ./node_modules/vitest/vitest.mjs run`) and exercises the real server.
 */
export default defineConfig({
  plugins: [textAssets],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
})
