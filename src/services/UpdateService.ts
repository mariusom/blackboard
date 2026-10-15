import { spawn } from "node:child_process"
import { Context, Effect, Layer, Ref, Semaphore, Stream, SubscriptionRef } from "effect"
import type { AvailableUpdate, CheckUpdateOptions } from "@gpuix/native"
import {
  APP_VERSION,
  GITHUB_REPO,
  INITIAL_UPDATE_INFO,
  isNewerVersion,
  resolveTargetAppBundlePath,
  UPDATER_PUBLIC_KEY,
  UpdateError,
  type UpdateInfo,
} from "../domain/models"

export interface UpdateServiceShape {
  readonly getUpdateState: Effect.Effect<UpdateInfo>
  readonly stateChanges: Stream.Stream<UpdateInfo>
  readonly checkForUpdates: Effect.Effect<UpdateInfo, UpdateError>
  readonly installUpdate: Effect.Effect<UpdateInfo, UpdateError>
  readonly restartApp: Effect.Effect<void, UpdateError>
  readonly openDownloadPage: Effect.Effect<void, UpdateError>
}

// Keep the native boundary injectable without loading the renderer in service tests.
export type SignedUpdate = Pick<AvailableUpdate, "version" | "downloadUrl" | "format" | "downloadAndInstall">
export interface UpdateDependencies {
  readonly publicKey: string
  readonly checkUpdate: (version: string, options: CheckUpdateOptions) => Promise<SignedUpdate | null>
  readonly execPath: string
  readonly platform: string
  readonly relaunch: (appPath: string) => Promise<void>
  readonly openExternal: (url: string) => Promise<void>
}

const defaults: UpdateDependencies = {
  publicKey: UPDATER_PUBLIC_KEY,
  checkUpdate: async (version, options) => (await import("@gpuix/native")).checkUpdate(version, options),
  execPath: process.execPath,
  platform: process.platform,
  openExternal: (url) => new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/open", [url], { stdio: "ignore" })
    child.once("error", reject)
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Could not open download page (${code})`)))
  }),
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
      const installedApp = deps.platform === "darwin" &&
        deps.execPath.includes(".app/Contents/MacOS/") &&
        !deps.execPath.startsWith("/Volumes/") &&
        !deps.execPath.includes("/AppTranslocation/")
      const canInstallAutomatically = installedApp && !!deps.publicKey.trim()
      const installHint = !installedApp
        ? "Drag Blackboard to Applications, eject the disk image, and open the installed app to enable automatic updates."
        : !deps.publicKey.trim()
          ? "Download the current signed app to enable automatic updates."
          : null
      const state = yield* SubscriptionRef.make<UpdateInfo>({
        ...INITIAL_UPDATE_INFO, canInstallAutomatically, installHint,
      })
      const markError = (error: UpdateError) => SubscriptionRef.update(state, (s): UpdateInfo => ({
        ...s, status: "error", errorMessage: error.message,
      }))
      const failure = (message: string, cause: unknown) => new UpdateError({
        message,
        cause: cause instanceof Error ? cause.message : String(cause),
      })
      const requireInstalledApp = Effect.gen(function* () {
        if (!canInstallAutomatically) {
          return yield* new UpdateError({ message: installHint ?? "Automatic updates are unavailable in this build." })
        }
        return resolveTargetAppBundlePath(deps.execPath)
      })
      const checkForUpdates = Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state)
        if (current.status === "ready-to-restart" || current.status === "restarting") return current
        yield* Ref.set(pending, null)
        yield* SubscriptionRef.update(state, (s): UpdateInfo => ({ ...s, status: "checking", hasUpdate: false, downloadUrl: null, errorMessage: null }))
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
        return yield* SubscriptionRef.updateAndGet(state, (s): UpdateInfo => ({
          ...s,
          latestVersion: update?.version.trim().replace(/^[vV]/, "") ?? APP_VERSION,
          releaseUrl: update ? `https://github.com/${GITHUB_REPO}/releases/tag/v${encodeURIComponent(update.version.trim().replace(/^[vV]/, ""))}` : INITIAL_UPDATE_INFO.releaseUrl,
          hasUpdate: update !== null,
          downloadUrl: update?.downloadUrl ?? null,
          status: update ? "available" : "up-to-date",
          errorMessage: null,
        }))
      }).pipe(Effect.tapError(markError), lock.withPermit)

      const installUpdate = Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state)
        if (current.status === "ready-to-restart" || current.status === "restarting") return current
        yield* requireInstalledApp
        const update = yield* Ref.get(pending)
        if (!update) return yield* new UpdateError({ message: "Check for a signed update before installing." })
        yield* SubscriptionRef.update(state, (s): UpdateInfo => ({ ...s, status: "downloading", errorMessage: null }))
        // GPUIX verifies the archive against the embedded public key before replacing files.
        // Do not interrupt the native replacement or re-sign the downloaded app.
        yield* Effect.tryPromise({
          try: () => update.downloadAndInstall(),
          catch: (cause) => failure("Update verification or installation failed. Please try again.", cause),
        })
        yield* Ref.set(pending, null)
        return yield* SubscriptionRef.updateAndGet(state, (s): UpdateInfo => ({ ...s, status: "ready-to-restart", errorMessage: null }))
      }).pipe(Effect.tapError(markError), Effect.uninterruptible, lock.withPermit)

      const restartApp = Effect.gen(function* () {
        if ((yield* SubscriptionRef.get(state)).status !== "ready-to-restart") {
          return yield* new UpdateError({ message: "No installed update is ready to restart." })
        }
        const appPath = yield* requireInstalledApp
        yield* SubscriptionRef.update(state, (s): UpdateInfo => ({ ...s, status: "restarting", errorMessage: null }))
        yield* Effect.tryPromise({
          try: () => deps.relaunch(appPath),
          catch: (cause) => failure("Could not restart Blackboard. Quit and reopen the app.", cause),
        })
      }).pipe(
        Effect.tapError((error) => SubscriptionRef.update(state, (s): UpdateInfo => ({ ...s, status: s.status === "restarting" ? "ready-to-restart" : s.status, errorMessage: error.message }))),
        lock.withPermit,
      )

      const openDownloadPage = Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state)
        const version = encodeURIComponent(current.latestVersion)
        const url = current.hasUpdate
          ? `https://github.com/${GITHUB_REPO}/releases/download/v${version}/Blackboard-${version}-aarch64.dmg`
          : INITIAL_UPDATE_INFO.releaseUrl
        yield* Effect.tryPromise({
          try: () => deps.openExternal(url),
          catch: (cause) => failure("Could not open the download. Visit github.com/mariusom/blackboard/releases in your browser.", cause),
        })
        yield* SubscriptionRef.update(state, (s): UpdateInfo => ({ ...s, status: "manual-download", errorMessage: null }))
      }).pipe(Effect.tapError((error) => SubscriptionRef.update(state, (s): UpdateInfo => ({ ...s, errorMessage: error.message }))))

      return UpdateService.of({
        getUpdateState: SubscriptionRef.get(state),
        stateChanges: SubscriptionRef.changes(state),
        checkForUpdates, installUpdate, restartApp, openDownloadPage,
      })
    }))

  static readonly layer = UpdateService.makeLayer()
}
