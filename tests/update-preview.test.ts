import { expect, it } from "bun:test"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { makeUpdatePreview } from "../src/workspace/updatePreview"

it("emulates checking, installation, restart-later, restart, and replay with no native dependencies", async () => {
  await Effect.runPromise(Effect.gen(function* () {
    const preview = yield* makeUpdatePreview
    const check = yield* preview.service.checkForUpdates.pipe(Effect.forkChild)
    yield* TestClock.adjust("900 millis")
    expect((yield* Fiber.join(check)).status).toBe("available")
    const install = yield* preview.service.installUpdate.pipe(Effect.forkChild)
    yield* TestClock.adjust("1 second")
    expect((yield* preview.service.getUpdateState).status).toBe("downloading")
    yield* TestClock.adjust("3 seconds")
    expect((yield* Fiber.join(install)).status).toBe("ready-to-restart")
    // Dismissing the panel requires no service mutation and preserves readiness.
    expect((yield* preview.service.getUpdateState).status).toBe("ready-to-restart")
    yield* preview.service.restartApp
    expect((yield* preview.service.getUpdateState).status).toBe("restarting")
    yield* preview.reset
    expect((yield* preview.service.getUpdateState).status).toBe("idle")
  }).pipe(Effect.provide(TestClock.layer())))
})
