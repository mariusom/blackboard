import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { APP_VERSION } from "../src/domain/models"
import { UpdateService, type SignedUpdate, type UpdateDependencies } from "../src/services/UpdateService"

const fakeUpdate = (install = async () => {}): SignedUpdate => ({
  version: "9.9.9",
  downloadUrl: "https://github.com/mariusom/blackboard/releases/download/v9.9.9/Blackboard-aarch64.app.tar.gz",
  format: "app",
  downloadAndInstall: install,
})
const layer = (overrides: Partial<UpdateDependencies> = {}) => UpdateService.makeLayer({
  publicKey: "pinned-test-key",
  execPath: "/Applications/Blackboard.app/Contents/MacOS/blackboard",
  platform: "darwin",
  checkUpdate: async () => fakeUpdate(),
  relaunch: async () => {},
  ...overrides,
})

const checkAndInstall = Effect.gen(function* () {
  const updates = yield* UpdateService
  yield* updates.checkForUpdates
  return yield* updates.installUpdate
})

describe("signed application updates", () => {
  it("starts idle and passes the embedded trust key and current version to the native verifier", async () => {
    let checked = false
    const result = await Effect.runPromise(Effect.gen(function* () {
      const updates = yield* UpdateService
      expect((yield* updates.getUpdateState).status).toBe("idle")
      return yield* updates.checkForUpdates
    }).pipe(Effect.provide(layer({ checkUpdate: async (version, options) => {
      expect(version).toBe(APP_VERSION)
      expect(options.pubkey).toBe("pinned-test-key")
      expect(options.endpoints).toEqual(["https://github.com/mariusom/blackboard/releases/latest"])
      checked = true
      return fakeUpdate()
    } }))))
    expect(checked).toBe(true)
    expect(result.status).toBe("available")
    expect(result.latestVersion).toBe("9.9.9")
  })

  it("refuses an unconfigured trust key before contacting the feed", async () => {
    let checked = false
    const state = await Effect.runPromise(Effect.gen(function* () {
      const updates = yield* UpdateService
      expect((yield* Effect.exit(updates.checkForUpdates))._tag).toBe("Failure")
      return yield* updates.getUpdateState
    }).pipe(Effect.provide(layer({ publicKey: "", checkUpdate: async () => { checked = true; return null } }))))
    expect(checked).toBe(false)
    expect(state.status).toBe("error")
    expect(state.errorMessage).toContain("not configured")
  })

  it("reports no update when the native verifier returns null", async () => {
    const state = await Effect.runPromise(Effect.gen(function* () {
      return yield* (yield* UpdateService).checkForUpdates
    }).pipe(Effect.provide(layer({ checkUpdate: async () => null }))))
    expect(state.status).toBe("up-to-date")
    expect(state.hasUpdate).toBe(false)
    expect(state.downloadUrl).toBeNull()
  })

  for (const update of [
    { ...fakeUpdate(), version: APP_VERSION },
    { ...fakeUpdate(), version: "0.0.0" },
    { ...fakeUpdate(), version: "invalid" },
    { ...fakeUpdate(), format: "dmg" },
    { ...fakeUpdate(), downloadUrl: "http://example.com/update.tar.gz" },
  ]) {
    it(`rejects unsupported update metadata: ${update.version}, ${update.format}, ${update.downloadUrl}`, async () => {
      const exit = await Effect.runPromise(Effect.gen(function* () {
        return yield* Effect.exit((yield* UpdateService).checkForUpdates)
      }).pipe(Effect.provide(layer({ checkUpdate: async () => update }))))
      expect(exit._tag).toBe("Failure")
    })
  }

  it("surfaces network and missing-signature failures without leaving an installable update", async () => {
    const state = await Effect.runPromise(Effect.gen(function* () {
      const updates = yield* UpdateService
      yield* Effect.exit(updates.checkForUpdates)
      expect((yield* Effect.exit(updates.installUpdate))._tag).toBe("Failure")
      return yield* updates.getUpdateState
    }).pipe(Effect.provide(layer({ checkUpdate: async () => { throw new Error("missing .sig") } }))))
    expect(state.status).toBe("error")
    expect(state.hasUpdate).toBe(false)
  })

  it("keeps signature failures visible and never reports readiness or restarts", async () => {
    let restarted = false
    const state = await Effect.runPromise(Effect.gen(function* () {
      const updates = yield* UpdateService
      yield* updates.checkForUpdates
      expect((yield* Effect.exit(updates.installUpdate))._tag).toBe("Failure")
      expect((yield* Effect.exit(updates.restartApp))._tag).toBe("Failure")
      return yield* updates.getUpdateState
    }).pipe(Effect.provide(layer({
      checkUpdate: async () => fakeUpdate(async () => { throw new Error("signature mismatch") }),
      relaunch: async () => { restarted = true },
    }))))
    expect(restarted).toBe(false)
    expect(state.status).toBe("error")
  })

  for (const execPath of ["/Volumes/Blackboard/Blackboard.app/Contents/MacOS/blackboard", "/tmp/dist/blackboard", "/private/var/folders/test/AppTranslocation/id/d/Blackboard.app/Contents/MacOS/blackboard"]) {
    it(`refuses installation from ${execPath}`, async () => {
      let installed = false
      const exit = await Effect.runPromise(Effect.exit(checkAndInstall).pipe(Effect.provide(layer({
        execPath,
        checkUpdate: async () => fakeUpdate(async () => { installed = true }),
      }))))
      expect(exit._tag).toBe("Failure")
      expect(installed).toBe(false)
    })
  }

  it("serializes installs, preserves readiness across checks, and restarts the installed bundle", async () => {
    let installs = 0
    let restartedPath = ""
    const state = await Effect.runPromise(Effect.gen(function* () {
      const updates = yield* UpdateService
      yield* updates.checkForUpdates
      yield* Effect.all([updates.installUpdate, updates.installUpdate], { concurrency: "unbounded" })
      const checked = yield* updates.checkForUpdates
      expect(checked.status).toBe("ready-to-restart")
      yield* updates.restartApp
      return yield* updates.getUpdateState
    }).pipe(Effect.provide(layer({
      checkUpdate: async () => fakeUpdate(async () => { installs++ }),
      relaunch: async (appPath) => { restartedPath = appPath },
    }))))
    expect(installs).toBe(1)
    expect(restartedPath).toBe("/Applications/Blackboard.app")
    expect(state.status).toBe("restarting")
  })

  it("allows a restart retry without reinstalling after relaunch fails", async () => {
    let attempts = 0
    const state = await Effect.runPromise(Effect.gen(function* () {
      const updates = yield* UpdateService
      yield* updates.checkForUpdates
      yield* updates.installUpdate
      expect((yield* Effect.exit(updates.restartApp))._tag).toBe("Failure")
      expect((yield* updates.getUpdateState).status).toBe("ready-to-restart")
      yield* updates.restartApp
      return yield* updates.getUpdateState
    }).pipe(Effect.provide(layer({ relaunch: async () => {
      attempts++
      if (attempts === 1) throw new Error("launch failed")
    } }))))
    expect(attempts).toBe(2)
    expect(state.status).toBe("restarting")
  })
})
