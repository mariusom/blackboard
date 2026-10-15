import { Effect, SubscriptionRef } from "effect"
import { APP_VERSION, INITIAL_UPDATE_INFO, UpdateError, type UpdateInfo } from "../domain/models"
import { UpdateService } from "../services/UpdateService"

/** An explicit UI demonstration. It has no native installer, browser opener, or
 * relaunch dependency, so trying every action cannot modify the installed app. */
export const makeUpdatePreview = Effect.gen(function* () {
  const nextVersion = `${APP_VERSION.split(".")[0]}.${Number(APP_VERSION.split(".")[1]) + 1}.0`
  const initial: UpdateInfo = { ...INITIAL_UPDATE_INFO, canInstallAutomatically: true }
  const state = yield* SubscriptionRef.make(initial)
  const checkForUpdates = Effect.gen(function* () {
    yield* SubscriptionRef.set(state, { ...initial, status: "checking" as const })
    yield* Effect.sleep("900 millis")
    return yield* SubscriptionRef.updateAndGet(state, s => ({ ...s, hasUpdate: true, latestVersion: nextVersion, status: "available" as const }))
  })
  const installUpdate = Effect.gen(function* () {
    const current = yield* SubscriptionRef.get(state)
    if (current.status === "ready-to-restart") return current
    if (current.status !== "available") return yield* new UpdateError({ message: "Run the preview update check first." })
    yield* SubscriptionRef.update(state, s => ({ ...s, status: "downloading" as const }))
    yield* Effect.sleep("4 seconds")
    return yield* SubscriptionRef.updateAndGet(state, s => ({ ...s, status: "ready-to-restart" as const }))
  })
  return {
    reset: SubscriptionRef.set(state, initial),
    service: UpdateService.of({
      getUpdateState: SubscriptionRef.get(state), stateChanges: SubscriptionRef.changes(state),
      checkForUpdates, installUpdate,
      restartApp: SubscriptionRef.update(state, s => ({ ...s, status: "restarting" as const })),
      openDownloadPage: SubscriptionRef.update(state, s => ({ ...s, status: "manual-download" as const })),
    }),
  }
})
