import { spawn } from "node:child_process"
import { Context, Effect, Layer, Ref, Semaphore } from "effect"
import type { AvailableUpdate, CheckUpdateOptions } from "@gpuix/native"
import {
  APP_VERSION,
  GITHUB_REPO,
  isNewerVersion,
  resolveTargetAppBundlePath,
  UPDATER_PUBLIC_KEY,
  UpdateError,
  type UpdateInfo,
} from "../domain/models"

export interface UpdateServiceShape {
  readonly getUpdateState: Effect.Effect<UpdateInfo>
  readonly checkForUpdates: Effect.Effect<UpdateInfo, UpdateError>
  readonly installUpdate: Effect.Effect<UpdateInfo, UpdateError>
  readonly restartApp: Effect.Effect<void, UpdateError>
}

// Keep the native boundary injectable without loading the renderer in service tests.
export type SignedUpdate = Pick<AvailableUpdate, "version" | "downloadUrl" | "format" | "downloadAndInstall">
export interface UpdateDependencies {
  readonly publicKey: string
  readonly checkUpdate: (version: string, options: CheckUpdateOptions) => Promise<SignedUpdate | null>
  readonly execPath: string
  readonly platform: string
  readonly relaunch: (appPath: string) => Promise<void>
}

const defaults: UpdateDependencies = {
  publicKey: UPDATER_PUBLIC_KEY,
  checkUpdate: async (version, options) => (await import("@gpuix/native")).checkUpdate(version, options),
  execPath: process.execPath,
  platform: process.platform,
  relaunch: (appPath) => new Promise<void>((resolve, reject) => {
    // Pass the app path as an argument, never interpolate it into shell code.
    const child = spawn("/bin/sh", ["-c", 'sleep 1; /usr/bin/open -n "$1"', "blackboard-restart", appPath], {
      detached: true,
      stdio: "ignore",
    })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      setTimeout(() => process.exit(0), 150)
      resolve()
    })
  }),
}

export class UpdateService extends Context.Service<UpdateService, UpdateServiceShape>()("blackboard/UpdateService") {
  static readonly makeLayer = (overrides: Partial<UpdateDependencies> = {}) =>
    Layer.effect(UpdateService, Effect.gen(function* () {
      const deps = { ...defaults, ...overrides }
      const lock = yield* Semaphore.make(1)
      const pending = yield* Ref.make<SignedUpdate | null>(null)
      const state = yield* Ref.make<UpdateInfo>({
        currentVersion: APP_VERSION,
        latestVersion: APP_VERSION,
        hasUpdate: false,
        downloadUrl: null,
        releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
        status: "idle",
        errorMessage: null,
      })
      const markError = (error: UpdateError) => Ref.update(state, (s): UpdateInfo => ({
        ...s, status: "error", errorMessage: error.message,
      }))
      const failure = (message: string, cause: unknown) => new UpdateError({
        message,
        cause: cause instanceof Error ? cause.message : String(cause),
      })
      const requireInstalledApp = Effect.gen(function* () {
        if (
          deps.platform !== "darwin" ||
          !deps.execPath.includes(".app/Contents/MacOS/") ||
          deps.execPath.startsWith("/Volumes/") ||
          deps.execPath.includes("/AppTranslocation/")
        ) {
          return yield* new UpdateError({ message: "Install Blackboard in Applications and launch it there before updating." })
        }
        return resolveTargetAppBundlePath(deps.execPath)
      })
      const checkForUpdates = Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (current.status === "ready-to-restart") return current
        yield* Ref.set(pending, null)
        yield* Ref.update(state, (s): UpdateInfo => ({ ...s, status: "checking", hasUpdate: false, downloadUrl: null, errorMessage: null }))
        if (!deps.publicKey.trim()) {
          return yield* new UpdateError({
            message: "Automatic updates are not configured in this build.",
            cause: "Missing updater public key",
          })
        }
        const update = yield* Effect.tryPromise({
          try: () => deps.checkUpdate(APP_VERSION, {
            endpoints: [`https://github.com/${GITHUB_REPO}/releases/latest`],
            pubkey: deps.publicKey,
            timeoutMs: 30_000,
          }),
          catch: (cause) => failure("Could not check for a signed update. Please try again later.", cause),
        })
        if (update && (!isNewerVersion(APP_VERSION, update.version) || update.format !== "app" || !update.downloadUrl.startsWith("https://"))) {
          return yield* new UpdateError({ message: "The update feed returned an unsupported release." })
        }
        yield* Ref.set(pending, update)
        return yield* Ref.updateAndGet(state, (s): UpdateInfo => ({
          ...s,
          latestVersion: update?.version ?? APP_VERSION,
          hasUpdate: update !== null,
          downloadUrl: update?.downloadUrl ?? null,
          status: update ? "available" : "up-to-date",
          errorMessage: null,
        }))
      }).pipe(Effect.tapError(markError), lock.withPermit)

      const installUpdate = Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (current.status === "ready-to-restart") return current
        yield* requireInstalledApp
        const update = yield* Ref.get(pending)
        if (!update) return yield* new UpdateError({ message: "Check for a signed update before installing." })
        yield* Ref.update(state, (s): UpdateInfo => ({ ...s, status: "downloading", errorMessage: null }))
        // GPUIX verifies the archive against the embedded public key before replacing files.
        // Do not interrupt the native replacement or re-sign the downloaded app.
        yield* Effect.tryPromise({
          try: () => update.downloadAndInstall(),
          catch: (cause) => failure("Update verification or installation failed. Please try again.", cause),
        })
        yield* Ref.set(pending, null)
        return yield* Ref.updateAndGet(state, (s): UpdateInfo => ({ ...s, status: "ready-to-restart", errorMessage: null }))
      }).pipe(Effect.tapError(markError), Effect.uninterruptible, lock.withPermit)

      const restartApp = Effect.gen(function* () {
        if ((yield* Ref.get(state)).status !== "ready-to-restart") {
          return yield* new UpdateError({ message: "No installed update is ready to restart." })
        }
        const appPath = yield* requireInstalledApp
        yield* Effect.tryPromise({
          try: () => deps.relaunch(appPath),
          catch: (cause) => failure("Could not restart Blackboard. Quit and reopen the app.", cause),
        })
      }).pipe(
        Effect.tapError((error) => Ref.update(state, (s): UpdateInfo => ({ ...s, errorMessage: error.message }))),
        lock.withPermit,
      )

      return UpdateService.of({ getUpdateState: Ref.get(state), checkForUpdates, installUpdate, restartApp })
    }))

  static readonly layer = UpdateService.makeLayer()
}
