import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { bumpProjectVersion } from "../scripts/bump-version"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"

describe("Effect v4 Version Bump Script", () => {
  it("verifies root package.json and packager.json have valid semver without mutating them", async () => {
    const rootPkg = JSON.parse(await fs.readFile("package.json", "utf-8"))
    const rootPackager = JSON.parse(await fs.readFile("packager.json", "utf-8"))

    const semverRegex = /^\d+\.\d+\.\d+$/
    expect(rootPkg.version).toBeDefined()
    expect(rootPkg.version).toMatch(semverRegex)
    expect(rootPackager.name).toBeDefined()
    expect(rootPackager.name).toBe("blackboard")
    expect(rootPackager.version).toBeDefined()
    expect(rootPackager.version).toMatch(semverRegex)
    expect(rootPkg.version).toBe(rootPackager.version)
  })

  it("builds via scripts/build.ts so the @gpuix/native .node addon is embedded", async () => {
    const rootPkg = JSON.parse(await fs.readFile("package.json", "utf-8"))
    expect(rootPkg.scripts.build).toBe("bun scripts/build.ts")

    const buildScript = await fs.readFile("scripts/build.ts", "utf-8")
    expect(buildScript).toContain("gpuix-native-embed")
    expect(buildScript).toContain("@gpuix/native")

    await fs.access(path.resolve("scripts/build.ts"))
  })

  it("bumps patch, minor, and major versions in an isolated temporary directory", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "blackboard-bump-test-"))
    try {
      const fixturePkg = { name: "test-blackboard", version: "0.0.0" }
      const fixturePackager = { name: "Blackboard", version: "0.0.0" }

      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify(fixturePkg, null, 2) + "\n"
      )
      await fs.writeFile(
        path.join(tempDir, "packager.json"),
        JSON.stringify(fixturePackager, null, 2) + "\n"
      )

      // 1. Patch bump: 0.0.0 -> 0.0.1
      const patchVersion = await Effect.runPromise(bumpProjectVersion("patch", tempDir))
      expect(patchVersion).toBe("0.0.1")

      const pkgAfterPatch = JSON.parse(
        await fs.readFile(path.join(tempDir, "package.json"), "utf-8")
      )
      const packagerAfterPatch = JSON.parse(
        await fs.readFile(path.join(tempDir, "packager.json"), "utf-8")
      )
      expect(pkgAfterPatch.version).toBe("0.0.1")
      expect(packagerAfterPatch.version).toBe("0.0.1")

      // 2. Minor bump: 0.0.1 -> 0.1.0
      const minorVersion = await Effect.runPromise(bumpProjectVersion("minor", tempDir))
      expect(minorVersion).toBe("0.1.0")

      const pkgAfterMinor = JSON.parse(
        await fs.readFile(path.join(tempDir, "package.json"), "utf-8")
      )
      expect(pkgAfterMinor.version).toBe("0.1.0")

      // 3. Major bump: 0.1.0 -> 1.0.0
      const majorVersion = await Effect.runPromise(bumpProjectVersion("major", tempDir))
      expect(majorVersion).toBe("1.0.0")

      const pkgAfterMajor = JSON.parse(
        await fs.readFile(path.join(tempDir, "package.json"), "utf-8")
      )
      expect(pkgAfterMajor.version).toBe("1.0.0")
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it("verifies CLI execution outputs strictly the single-line version string to stdout", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "blackboard-cli-bump-test-"))
    try {
      const fixturePkg = { name: "test-cli-blackboard", version: "1.2.3" }
      const fixturePackager = { name: "Blackboard", version: "1.2.3" }

      await fs.writeFile(
        path.join(tempDir, "package.json"),
        JSON.stringify(fixturePkg, null, 2) + "\n"
      )
      await fs.writeFile(
        path.join(tempDir, "packager.json"),
        JSON.stringify(fixturePackager, null, 2) + "\n"
      )

      const scriptPath = path.resolve("scripts/bump-version.ts")
      const proc = Bun.spawn(["bun", scriptPath, "patch"], {
        cwd: tempDir,
        stdout: "pipe",
        stderr: "pipe",
      })

      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const exitCode = await proc.exited

      expect(exitCode).toBe(0)
      expect(stderr.trim()).toBe("")
      // Verify stdout is strictly single-line version string (e.g. "1.2.4\n")
      expect(stdout).toBe("1.2.4\n")
      expect(stdout.trim()).toBe("1.2.4")
      expect(stdout.trim().split("\n")).toHaveLength(1)
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
