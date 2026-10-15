import { expect, it } from "bun:test"
import React from "react"
import { createTestRoot, hasNativeTestRenderer, type TestRoot } from "@gpuix/react/testing"
import { Effect, Layer, ManagedRuntime } from "effect"
import { App } from "../src/App"
import { ActivityService } from "../src/services/ActivityService"
import { CanvasService } from "../src/services/CanvasService"
import { CounterService } from "../src/services/CounterService"
import { GreetingService } from "../src/services/GreetingService"
import { ThemeService } from "../src/services/ThemeService"
import { UpdateService, type UpdateDependencies } from "../src/services/UpdateService"

const nativeIt = it.skipIf(!hasNativeTestRenderer)
const signedUpdate = (install = async () => {}) => ({
  version: "9.9.9", format: "app", downloadUrl: "https://example.com/update.app.tar.gz", downloadAndInstall: install,
})

async function withUpdateFlow(overrides: Partial<UpdateDependencies>, run: (flow: {
  readonly root: TestRoot
  readonly flush: () => Promise<void>
  readonly click: (testId: string) => void
}) => Promise<void>) {
  const runtime = ManagedRuntime.make(Layer.mergeAll(
    ActivityService.layer, CanvasService.layer, CounterService.layer, GreetingService.layer, ThemeService.layer,
    UpdateService.makeLayer({
      publicKey: "fixture-public-key",
      execPath: "/Applications/Blackboard.app/Contents/MacOS/blackboard",
      platform: "darwin",
      checkUpdate: async () => signedUpdate(),
      relaunch: async () => {},
      openExternal: async () => {},
      ...overrides,
    }),
  ))
  const root = createTestRoot({ width: 1024, height: 720 })
  const view = <App runtime={runtime} />
  const flush = async () => {
    // Drain the React passive-effect and promise queues before native painting.
    await new Promise<void>((resolve) => setImmediate(resolve))
    root.render(view)
  }
  const click = (testId: string) => {
    const element = root.renderer.findByTestId(testId)
    expect(element, `Missing action: ${testId}`).toBeDefined()
    if (!element) throw new Error(`Missing action: ${testId}`)
    const bounds = root.renderer.getElementBounds(element.id)
    if (!bounds) throw new Error(`Action has no native bounds: ${testId}`)
    root.renderer.nativeSimulateClick(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  }
  try {
    await runtime.runPromise(Effect.gen(function* () { return yield* (yield* UpdateService).checkForUpdates }))
    root.render(view)
    await flush()
    await run({ root, flush, click })
  } finally {
    root.unmount()
    await runtime.dispose()
  }
}

nativeIt("offers an actionable update panel when a new release is available", async () => {
  await withUpdateFlow({}, async ({ root }) => {
    expect(root.renderer.findByTestId("update-panel")).toBeDefined()
    expect(root.renderer.getAllText()).toContain("Blackboard 9.9.9 is ready")
    expect(root.renderer.findByTestId("update-install")).toBeDefined()
    expect(root.renderer.findByTestId("update-download")).toBeDefined()
  })
})

nativeIt("shows live progress, prevents duplicate installs, and offers restart now or later", async () => {
  const started = Promise.withResolvers<void>()
  const finished = Promise.withResolvers<void>()
  const restarted = Promise.withResolvers<void>()
  let installs = 0
  await withUpdateFlow({
    checkUpdate: async () => signedUpdate(async () => {
      installs++
      started.resolve()
      await finished.promise
    }),
    relaunch: async () => { restarted.resolve() },
  }, async ({ root, click, flush }) => {
    click("update-install")
    await started.promise
    await flush()
    expect(root.renderer.findByTestId("update-progress")).toBeDefined()
    expect(root.renderer.getAllText()).toContain("Updating Blackboard…")
    expect(root.renderer.getAllText()).not.toContain("Restart now")
    const footer = root.renderer.findByTestId("app-footer")
    if (!footer) throw new Error("Missing app footer")
    const footerBounds = root.renderer.getElementBounds(footer.id)
    if (!footerBounds) throw new Error("Missing footer bounds")
    expect(footerBounds.y + footerBounds.height).toBeLessThanOrEqual(720)
    click("update-install")
    expect(installs).toBe(1)
    finished.resolve()
    await flush()
    expect(root.renderer.getAllText()).toContain("Your update is installed")
    expect(root.renderer.getAllText()).toContain("Restart now")
    click("update-dismiss")
    await flush()
    expect(root.renderer.findByTestId("update-panel")).toBeUndefined()
    expect(root.renderer.getAllText()).toContain("Restart to update")
    click("update-menu")
    await flush()
    expect(root.renderer.getAllText()).toContain("Restart now")
    click("update-restart")
    await restarted.promise
    await flush()
    expect(root.renderer.getAllText()).toContain("Restarting Blackboard…")
    expect(installs).toBe(1)
  })
})

nativeIt("offers the DMG and installation instructions when running from a mounted image", async () => {
  const opened = Promise.withResolvers<string>()
  let installs = 0
  await withUpdateFlow({
    execPath: "/Volumes/Blackboard/Blackboard.app/Contents/MacOS/blackboard",
    checkUpdate: async () => signedUpdate(async () => { installs++ }),
    openExternal: async (url) => { opened.resolve(url) },
  }, async ({ root, click, flush }) => {
    expect(root.renderer.findByTestId("update-install")).toBeUndefined()
    expect(root.renderer.getAllText().some((text) => text.includes("Drag Blackboard to Applications"))).toBe(true)
    click("update-download")
    expect(await opened.promise).toBe("https://github.com/mariusom/blackboard/releases/download/v9.9.9/Blackboard-9.9.9-aarch64.dmg")
    await flush()
    expect(root.renderer.getAllText()).toContain("Continue with the DMG")
    expect(root.renderer.getAllText().some((text) => text.includes("Your browser is opening the download"))).toBe(true)
    expect(installs).toBe(0)
  })
})

nativeIt("shows verification failures with retry and manual download actions", async () => {
  let installs = 0
  const failed = Promise.withResolvers<void>()
  await withUpdateFlow({ checkUpdate: async () => signedUpdate(async () => {
    installs++
    if (installs === 1) {
      failed.resolve()
      throw new Error("Signature does not match")
    }
  }) }, async ({ root, click, flush }) => {
    click("update-install")
    await failed.promise
    await flush()
    expect(root.renderer.findByTestId("update-error")).toBeDefined()
    expect(root.renderer.getAllText()).toContain("Try again")
    expect(root.renderer.findByTestId("update-download")).toBeDefined()
    expect(root.renderer.getAllText()).not.toContain("Restart now")
    click("update-install")
    await flush()
    expect(root.renderer.getAllText()).toContain("Your update is installed")
    expect(installs).toBe(2)
  })
})
