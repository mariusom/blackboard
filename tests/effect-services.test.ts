import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { GreetingService } from "../src/services/GreetingService"
import { CounterService } from "../src/services/CounterService"
import { ActivityService } from "../src/services/ActivityService"
import { ThemeService } from "../src/services/ThemeService"
import { UpdateService } from "../src/services/UpdateService"
import { appRuntime } from "../src/services/AppRuntime"
import {
  APP_VERSION,
  INITIAL_GREETINGS,
  isNewerVersion,
  parseSemVer,
  resolveTargetAppBundlePath,
} from "../src/domain/models"

describe("Effect v4 Services & Domain Logic", () => {
  it("initializes with default greeting and cycles correctly", async () => {
    const program = Effect.gen(function* () {
      const service = yield* GreetingService
      const initial = yield* service.getCurrentGreeting
      const index0 = yield* service.getGreetingIndex
      const next = yield* service.nextGreeting
      const index1 = yield* service.getGreetingIndex
      const prev = yield* service.previousGreeting
      const index2 = yield* service.getGreetingIndex

      return { initial, index0, next, index1, prev, index2 }
    })

    const result = await appRuntime.runPromise(program)
    expect(result.initial.id).toBe(INITIAL_GREETINGS[0].id)
    expect(result.index0).toBe(0)
    expect(result.next.id).toBe(INITIAL_GREETINGS[1].id)
    expect(result.index1).toBe(1)
    expect(result.prev.id).toBe(INITIAL_GREETINGS[0].id)
    expect(result.index2).toBe(0)
  })

  it("selects greeting by id and returns typed GreetingError on missing id", async () => {
    const programSuccess = Effect.gen(function* () {
      const service = yield* GreetingService
      return yield* service.selectGreetingById("ja")
    })

    const japaneseGreeting = await appRuntime.runPromise(programSuccess)
    expect(japaneseGreeting.language).toBe("日本語")
    expect(japaneseGreeting.flag).toBe("🇯🇵")

    const programFailure = Effect.gen(function* () {
      const service = yield* GreetingService
      return yield* service.selectGreetingById("invalid-id")
    })

    const failureExit = await appRuntime.runPromiseExit(programFailure)
    expect(failureExit._tag).toBe("Failure")
  })

  it("increments, decrements, and enforces counter boundaries with CounterError", async () => {
    const program = Effect.gen(function* () {
      const counter = yield* CounterService
      yield* counter.reset
      const c0 = yield* counter.getCount
      const c1 = yield* counter.increment(1)
      const c2 = yield* counter.increment(5)
      const c3 = yield* counter.decrement(2)

      const failingExit = yield* Effect.exit(counter.decrement(10))

      return { c0, c1, c2, c3, failingExit }
    })

    const result = await appRuntime.runPromise(program)
    expect(result.c0).toBe(0)
    expect(result.c1).toBe(1)
    expect(result.c2).toBe(6)
    expect(result.c3).toBe(4)
    expect(result.failingExit._tag).toBe("Failure")
    if (result.failingExit._tag === "Failure") {
      expect(result.failingExit.cause.toString()).toContain("CounterError")
      expect(result.failingExit.cause.toString()).toContain("cannot be decremented below 0")
    }
  })

  it("records and clears telemetry events in ActivityService", async () => {
    const program = Effect.gen(function* () {
      const activity = yield* ActivityService
      yield* activity.clear
      const initialHistory = yield* activity.getHistory
      yield* activity.record("Test Action", "Testing details", "info")
      yield* activity.record("Another Action", "Success details", "success")
      const updatedHistory = yield* activity.getHistory

      return { initialCount: initialHistory.length, updatedHistory }
    })

    const result = await appRuntime.runPromise(program)
    expect(result.initialCount).toBe(0)
    expect(result.updatedHistory.length).toBe(2)
    expect(result.updatedHistory[0].action).toBe("Another Action")
    expect(result.updatedHistory[1].action).toBe("Test Action")
  })

  it("cycles and manages application themes via ThemeService", async () => {
    const program = Effect.gen(function* () {
      const themeSvc = yield* ThemeService
      yield* themeSvc.setTheme("charcoal")
      const t1 = yield* themeSvc.getTheme
      const t2 = yield* themeSvc.cycleTheme
      const t3 = yield* themeSvc.cycleTheme
      const t4 = yield* themeSvc.cycleTheme

      return { t1, t2, t3, t4 }
    })

    const result = await appRuntime.runPromise(program)
    expect(result.t1.id).toBe("charcoal")
    expect(result.t2.id).toBe("midnight")
    expect(result.t3.id).toBe("slate")
    expect(result.t4.id).toBe("charcoal")
  })
})

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

const mockReleasePayload = (tag: string) => ({
  tag_name: tag,
  name: `Blackboard ${tag}`,
  html_url: `https://github.com/mariusom/blackboard/releases/tag/${tag}`,
  body: "## Release notes",
  assets: [
    {
      name: `Blackboard-${tag.replace(/^[vV]/, "")}.dmg`,
      browser_download_url: `https://example.com/Blackboard-${tag.replace(/^[vV]/, "")}.dmg`,
      size: 1024,
    },
    {
      name: "latest-mac.yml",
      browser_download_url: "https://example.com/latest-mac.yml",
      size: 64,
    },
  ],
})

const jsonResponseFetch = (payload: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch

const failingFetch = (error: unknown): typeof fetch =>
  (async () => {
    throw error
  }) as unknown as typeof fetch

describe("UpdateService with mocked fetch", () => {
  it("initial state is idle with no update available", async () => {
    const program = Effect.gen(function* () {
      const updates = yield* UpdateService
      return yield* updates.getUpdateState
    })

    const initial = await Effect.runPromise(
      program.pipe(Effect.provide(UpdateService.makeLayer(jsonResponseFetch({})))),
    )

    expect(initial.status).toBe("idle")
    expect(initial.hasUpdate).toBe(false)
    expect(initial.currentVersion).toBe(APP_VERSION)
    expect(initial.latestVersion).toBe(APP_VERSION)
    expect(initial.downloadUrl).toBeNull()
    expect(initial.errorMessage).toBeNull()
  })

  it("checkForUpdates detects newer release with DMG asset: available, downloadUrl populated", async () => {
    const program = Effect.gen(function* () {
      const updates = yield* UpdateService
      const info = yield* updates.checkForUpdates
      const state = yield* updates.getUpdateState
      return { info, state }
    })

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(UpdateService.makeLayer(jsonResponseFetch(mockReleasePayload("v9.9.9")))),
      ),
    )

    const expectedDownloadUrl = "https://example.com/Blackboard-9.9.9.dmg"
    expect(result.info.currentVersion).toBe(APP_VERSION)
    expect(result.info.latestVersion).toBe("9.9.9")
    expect(result.info.hasUpdate).toBe(true)
    expect(result.info.status).toBe("available")
    expect(result.info.downloadUrl).toBe(expectedDownloadUrl)
    expect(result.info.releaseUrl).toBe(
      "https://github.com/mariusom/blackboard/releases/tag/v9.9.9",
    )
    expect(result.info.errorMessage).toBeNull()
    expect(result.state).toEqual(result.info)
  })

  it("checkForUpdates reports up-to-date when latest release matches current version", async () => {
    const program = Effect.gen(function* () {
      const updates = yield* UpdateService
      return yield* updates.checkForUpdates
    })

    const info = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          UpdateService.makeLayer(jsonResponseFetch(mockReleasePayload(`v${APP_VERSION}`))),
        ),
      ),
    )

    expect(info.hasUpdate).toBe(false)
    expect(info.status).toBe("up-to-date")
    expect(info.latestVersion).toBe(APP_VERSION)
    expect(info.errorMessage).toBeNull()
  })

  it("checkForUpdates fails with UpdateError and sets error status on HTTP 500", async () => {
    const program = Effect.gen(function* () {
      const updates = yield* UpdateService
      const exit = yield* Effect.exit(updates.checkForUpdates)
      const state = yield* updates.getUpdateState
      return { exit, state }
    })

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          UpdateService.makeLayer(
            jsonResponseFetch({ message: "Internal Server Error" }, 500),
          ),
        ),
      ),
    )

    expect(result.exit._tag).toBe("Failure")
    if (result.exit._tag === "Failure") {
      expect(result.exit.cause.toString()).toContain("UpdateError")
    }
    expect(result.state.status).toBe("error")
    expect(result.state.errorMessage).toContain("HTTP 500")
  })

  it("checkForUpdates fails with UpdateError and sets error status on network error", async () => {
    const program = Effect.gen(function* () {
      const updates = yield* UpdateService
      const exit = yield* Effect.exit(updates.checkForUpdates)
      const state = yield* updates.getUpdateState
      return { exit, state }
    })

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(
          UpdateService.makeLayer(failingFetch(new Error("fetch failed: ECONNREFUSED"))),
        ),
      ),
    )

    expect(result.exit._tag).toBe("Failure")
    if (result.exit._tag === "Failure") {
      expect(result.exit.cause.toString()).toContain("UpdateError")
    }
    expect(result.state.status).toBe("error")
    expect(result.state.errorMessage).toContain("GitHub Releases API")
    expect(result.state.errorMessage).not.toBeNull()
  })
})
