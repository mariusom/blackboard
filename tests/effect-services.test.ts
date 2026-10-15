import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { GreetingService } from "../src/services/GreetingService"
import { CounterService } from "../src/services/CounterService"
import { ActivityService } from "../src/services/ActivityService"
import { ThemeService } from "../src/services/ThemeService"
import { appRuntime } from "../src/services/AppRuntime"
import {
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
