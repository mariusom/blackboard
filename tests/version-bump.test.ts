import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { bumpProjectVersion } from "../scripts/bump-version"
import * as fs from "node:fs/promises"

describe("Effect v4 Version Bump Script", () => {
  it("bumps patch version from 0.0.0 to 0.0.1 and syncs package.json and packager.json", async () => {
    // Read original
    const origPkg = JSON.parse(await fs.readFile("package.json", "utf-8"))
    expect(origPkg.version).toBe("0.0.0")

    // Run patch bump
    const newVersion = await Effect.runPromise(bumpProjectVersion("patch"))
    expect(newVersion).toBe("0.0.1")

    const updatedPkg = JSON.parse(await fs.readFile("package.json", "utf-8"))
    const updatedPackager = JSON.parse(await fs.readFile("packager.json", "utf-8"))
    expect(updatedPkg.version).toBe("0.0.1")
    expect(updatedPackager.version).toBe("0.0.1")

    // Run minor bump: 0.0.1 -> 0.1.0
    const minorVersion = await Effect.runPromise(bumpProjectVersion("minor"))
    expect(minorVersion).toBe("0.1.0")

    // Run major bump: 0.1.0 -> 1.0.0
    const majorVersion = await Effect.runPromise(bumpProjectVersion("major"))
    expect(majorVersion).toBe("1.0.0")

    // Reset back to 0.0.0 for initial release state
    origPkg.version = "0.0.0"
    await fs.writeFile("package.json", JSON.stringify(origPkg, null, 2) + "\n")
    const origPackager = JSON.parse(await fs.readFile("packager.json", "utf-8"))
    origPackager.version = "0.0.0"
    await fs.writeFile("packager.json", JSON.stringify(origPackager, null, 2) + "\n")

    const resetPkg = JSON.parse(await fs.readFile("package.json", "utf-8"))
    expect(resetPkg.version).toBe("0.0.0")
  })
})
