import { describe, it, expect } from "@effect/vitest"
import { isNewerVersion, parseSemVer, resolveTargetAppBundlePath } from "../src/domain/models"

describe("Update domain helpers", () => {
  it("parseSemVer strips v/V prefixes, parses triplets, and rejects invalid input", () => {
    expect(parseSemVer("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseSemVer("v0.0.1")).toEqual({ major: 0, minor: 0, patch: 1 })
    expect(parseSemVer("V10.20.30")).toEqual({ major: 10, minor: 20, patch: 30 })
    expect(parseSemVer("1.2")).toBeNull()
    expect(parseSemVer("1.2.3.4")).toBeNull()
    expect(parseSemVer("beta")).toBeNull()
    expect(parseSemVer("")).toBeNull()
  })

  it("isNewerVersion compares SemVer strings strictly (candidate > current)", () => {
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(true)
    expect(isNewerVersion("1.0.0", "1.1.0")).toBe(true)
    expect(isNewerVersion("1.9.9", "2.0.0")).toBe(true)
    expect(isNewerVersion("v0.0.1", "v0.0.2")).toBe(true)
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false)
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(false)
    expect(isNewerVersion("2.0.0", "1.99.99")).toBe(false)
    expect(isNewerVersion("1.0.0", "invalid")).toBe(false)
    expect(isNewerVersion("invalid", "1.0.0")).toBe(false)
  })

  it("resolveTargetAppBundlePath only derives the bundle from non-mounted .app exec paths", () => {
    expect(
      resolveTargetAppBundlePath("/Applications/Blackboard.app/Contents/MacOS/blackboard"),
    ).toBe("/Applications/Blackboard.app")
    expect(
      resolveTargetAppBundlePath(
        "/Volumes/Blackboard 9.9.9/Blackboard.app/Contents/MacOS/blackboard",
      ),
    ).toBe("/Applications/Blackboard.app")
    expect(resolveTargetAppBundlePath("/home/user/.t3/projects/blackboard/dist/blackboard")).toBe(
      "/Applications/Blackboard.app",
    )
  })
})
