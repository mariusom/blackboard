import { spawn } from "node:child_process"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { Context, Effect, Layer, Ref, Schema } from "effect"
import {
  APP_VERSION,
  GitHubRelease,
  GITHUB_REPO,
  isNewerVersion,
  resolveTargetAppBundlePath,
  UpdateError,
  type UpdateInfo,
} from "../domain/models"

const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

export interface UpdateServiceShape {
  readonly getUpdateState: Effect.Effect<UpdateInfo>
  readonly checkForUpdates: Effect.Effect<UpdateInfo, UpdateError>
  readonly installUpdate: Effect.Effect<UpdateInfo, UpdateError>
  readonly restartApp: Effect.Effect<void, UpdateError>
}

export class UpdateService extends Context.Service<
  UpdateService,
  UpdateServiceShape
>()("blackboard/UpdateService") {
  static readonly makeLayer = (customFetch?: typeof fetch) =>
    Layer.effect(
      UpdateService,
      Effect.gen(function* () {
        const doFetch = customFetch ?? globalThis.fetch

        const stateRef = yield* Ref.make<UpdateInfo>({
          currentVersion: APP_VERSION,
          latestVersion: APP_VERSION,
          hasUpdate: false,
          downloadUrl: null,
          releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
          status: "idle",
          errorMessage: null,
        })

        const getUpdateState = Ref.get(stateRef)

        const setStatus = (
          next: UpdateInfo["status"],
          errorMessage: string | null = null,
        ): Effect.Effect<void> =>
          Ref.update(stateRef, (s): UpdateInfo => ({ ...s, status: next, errorMessage }))

        const markError = (error: UpdateError): Effect.Effect<void> =>
          Ref.update(stateRef, (s): UpdateInfo => ({ ...s, status: "error", errorMessage: error.message }))

        const toUpdateError = (
          message: string,
          cause: unknown,
        ): UpdateError =>
          new UpdateError({
            message,
            cause: cause instanceof Error ? cause.message : String(cause),
          })

        const runCommand = (cmd: readonly string[]) =>
          Effect.tryPromise({
            try: () =>
              new Promise<void>((resolve, reject) => {
                const [program, ...args] = cmd
                const child = spawn(program!, args, { stdio: "ignore" })
                child.once("error", reject)
                child.once("close", (code) => {
                  if (code === 0) {
                    resolve()
                  } else {
                    reject(new Error(`Command '${cmd.join(" ")}' exited with code ${code}`))
                  }
                })
              }),
            catch: (cause) => toUpdateError(`Update command failed: ${cmd.join(" ")}`, cause),
          })

        const fetchLatestRelease = Effect.gen(function* () {
          const response = yield* Effect.tryPromise({
            try: () =>
              doFetch(LATEST_RELEASE_API_URL, {
                headers: {
                  Accept: "application/vnd.github+json",
                  "User-Agent": `Blackboard-App/${APP_VERSION}`,
                },
              }),
            catch: (cause) =>
              toUpdateError("Failed to contact GitHub Releases API", cause),
          })
          if (!response.ok) {
            return yield* new UpdateError({
              message: `GitHub Releases API returned HTTP ${response.status}`.trim(),
            })
          }
          const payload = yield* Effect.tryPromise({
            try: () => response.json(),
            catch: (cause) =>
              toUpdateError("Failed to read GitHub Releases API JSON body", cause),
          })
          return yield* Schema.decodeUnknownEffect(GitHubRelease)(payload).pipe(
            Effect.mapError((cause) =>
              toUpdateError("Invalid GitHub release payload from API", cause),
            ),
          )
        })

        const checkForUpdates: Effect.Effect<UpdateInfo, UpdateError> = Effect.gen(function* () {
          yield* setStatus("checking")
          return yield* fetchLatestRelease.pipe(
            Effect.flatMap((release) =>
              Effect.gen(function* () {
                const latestVersion = release.tag_name.replace(/^[vV]/, "")
                const downloadUrl =
                  release.assets.find((asset) => asset.name.endsWith(".dmg"))
                    ?.browser_download_url ?? null
                const hasUpdate = isNewerVersion(APP_VERSION, latestVersion)
                const next: UpdateInfo = {
                  currentVersion: APP_VERSION,
                  latestVersion,
                  hasUpdate,
                  downloadUrl,
                  releaseUrl: release.html_url,
                  status: hasUpdate ? "available" : "up-to-date",
                  errorMessage: null,
                }
                yield* Ref.set(stateRef, next)
                yield* Effect.logInfo(
                  `UpdateService: latest release v${latestVersion}, hasUpdate=${hasUpdate}`,
                )
                return next
              }),
            ),
            Effect.tapError(markError),
          )
        })

        const installUpdate: Effect.Effect<UpdateInfo, UpdateError> = Effect.gen(function* () {
          const state = yield* Ref.get(stateRef)
          const downloadUrl = state.downloadUrl
          if (!downloadUrl) {
            return yield* new UpdateError({
              message: "No DMG download URL available for update",
            })
          }
          if (process.platform !== "darwin") {
            return yield* new UpdateError({
              message: "Automatic DMG installation is only supported on macOS",
            })
          }

          yield* setStatus("downloading")
          const dmgPath = path.join(os.tmpdir(), `Blackboard-${state.latestVersion}.dmg`)
          const response = yield* Effect.tryPromise({
            try: () => doFetch(downloadUrl),
            catch: (cause) => toUpdateError("Failed to download update DMG", cause),
          })
          if (!response.ok) {
            return yield* new UpdateError({
              message: `DMG download failed with HTTP ${response.status}`,
            })
          }
          const bytes = yield* Effect.tryPromise({
            try: async () => new Uint8Array(await response.arrayBuffer()),
            catch: (cause) => toUpdateError("Failed to read update DMG body", cause),
          })
          yield* Effect.tryPromise({
            try: () => fs.writeFile(dmgPath, bytes),
            catch: (cause) =>
              toUpdateError(`Failed to write temporary DMG to ${dmgPath}`, cause),
          })

          yield* setStatus("installing")
          const mountPoint = path.join(
            os.tmpdir(),
            `blackboard-Updater-mount-${Date.now()}`,
          )
          const targetAppPath = resolveTargetAppBundlePath(process.execPath)
          const sourceAppPath = path.join(mountPoint, "Blackboard.app")

          yield* Effect.tryPromise({
            try: () => fs.mkdir(mountPoint, { recursive: true }),
            catch: (cause) =>
              toUpdateError(`Failed to create DMG mount point ${mountPoint}`, cause),
          })

          yield* Effect.scoped(
            Effect.acquireUseRelease(
              runCommand([
                "hdiutil",
                "attach",
                "-nobrowse",
                "-readonly",
                "-mountpoint",
                mountPoint,
                dmgPath,
              ]),
              () =>
                Effect.gen(function* () {
                  yield* Effect.tryPromise({
                    try: () => fs.rm(targetAppPath, { recursive: true, force: true }),
                    catch: (cause) =>
                      toUpdateError(
                        `Failed to remove existing app bundle at ${targetAppPath}`,
                        cause,
                      ),
                  })
                  yield* runCommand(["cp", "-R", sourceAppPath, targetAppPath])
                  yield* runCommand(["xattr", "-cr", targetAppPath])
                  yield* runCommand([
                    "codesign",
                    "--force",
                    "--deep",
                    "--sign",
                    "-",
                    targetAppPath,
                  ])
                }),
              () =>
                Effect.gen(function* () {
                  yield* runCommand(["hdiutil", "detach", mountPoint, "-force"]).pipe(
                    Effect.ignore,
                  )
                  yield* Effect.tryPromise({
                    try: () => fs.rm(dmgPath, { force: true }),
                    catch: () =>
                      new UpdateError({ message: "Failed to delete temporary DMG" }),
                  }).pipe(Effect.ignore)
                }),
            ),
          )

          yield* Effect.logInfo(
            `UpdateService: installed v${state.latestVersion} to ${targetAppPath}`,
          )
          return yield* Ref.updateAndGet(stateRef, (s): UpdateInfo => ({
            ...s,
            status: "ready-to-restart",
            errorMessage: null,
          }))
        })

        const restartApp: Effect.Effect<void, UpdateError> = Effect.gen(function* () {
          const targetAppPath = resolveTargetAppBundlePath(process.execPath)
          yield* Effect.sync(() => {
            const child = spawn(
              "sh",
              ["-c", `sleep 0.6 && open -n "${targetAppPath}"`],
              { detached: true, stdio: "ignore" },
            )
            child.unref()
            setTimeout(() => process.exit(0), 150)
          })
        })

        return UpdateService.of({
          getUpdateState,
          checkForUpdates,
          installUpdate,
          restartApp,
        })
      }),
    )

  static readonly layer = UpdateService.makeLayer(globalThis.fetch)
}
