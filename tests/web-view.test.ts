import { expect, it } from "bun:test"
import type { Board } from "../src/workspace/model"
import type { UpdateInfo } from "../src/domain/models"
import { INITIAL_UPDATE_INFO } from "../src/domain/models"
import { canvasRow, emptyLibraryMessage, visibleCanvases } from "../src/web/library"
import { describeUpdate } from "../src/web/updateView"

const board = (over: Partial<Board> = {}): Board => ({ id: "a", name: "Landing page", x: 0, y: 0, width: 760, height: 560, html: "<h1>Hi</h1>", revision: 0, ...over })
const info = (over: Partial<UpdateInfo> = {}): UpdateInfo => ({ ...INITIAL_UPDATE_INFO, ...over })

it("filters canvases by name case-insensitively and trims the query", () => {
  const boards = [board({ id: "a", name: "Landing page" }), board({ id: "b", name: "Mobile app" })]
  expect(visibleCanvases(boards, "").map(b => b.id)).toEqual(["a", "b"])
  expect(visibleCanvases(boards, "  ").map(b => b.id)).toEqual(["a", "b"])
  expect(visibleCanvases(boards, "MOBILE").map(b => b.id)).toEqual(["b"])
  expect(visibleCanvases(boards, "absent")).toEqual([])
})

it("describes a library row's icon, size, label, and selection", () => {
  expect(canvasRow(board({ width: 800, height: 600 }), "a")).toEqual({ icon: "▤", label: "Landing page", size: "800 × 600", active: true })
  expect(canvasRow(board({ width: 390, height: 844 }), null)).toEqual({ icon: "▯", label: "Landing page", size: "390 × 844", active: false })
  expect(emptyLibraryMessage("x")).toBe("No matching canvases.")
  expect(emptyLibraryMessage("  ")).toContain("will appear here")
})

it("derives the update dialog's title, message, progress, and steps", () => {
  const idle = describeUpdate(info(), false)
  expect(idle.title).toBe("App updates")
  expect(idle.working).toBe(false)
  expect(idle.message).toContain("Check for the latest signed release")

  const available = describeUpdate(info({ status: "available", hasUpdate: true, latestVersion: "9.9.9" }), false)
  expect(available.title).toBe("Blackboard 9.9.9")
  expect(available.steps.map(step => step.state)).toEqual(["current", "todo", "todo"])

  const downloading = describeUpdate(info({ status: "downloading", hasUpdate: true, latestVersion: "9.9.9" }), false)
  expect(downloading.working).toBe(true)
  expect(downloading.steps.map(step => step.state)).toEqual(["done", "current", "todo"])
  expect(downloading.steps[0].marker).toBe("✓")

  const ready = describeUpdate(info({ status: "ready-to-restart", hasUpdate: true, latestVersion: "9.9.9" }), false)
  expect(ready.title).toBe("Ready when you are.")
  expect(ready.steps.map(step => step.state)).toEqual(["done", "done", "current"])
})

it("distinguishes the interactive preview from a real restart and download", () => {
  const simulated = describeUpdate(info({ status: "restarting", hasUpdate: true, latestVersion: "9.9.9" }), true)
  expect(simulated.title).toBe("You're all set.")
  expect(simulated.working).toBe(false)
  expect(simulated.message).toContain("Restart simulated")

  const real = describeUpdate(info({ status: "restarting", hasUpdate: true, latestVersion: "9.9.9" }), false)
  expect(real.working).toBe(true)
  expect(real.message).toContain("Restarting Blackboard")

  expect(describeUpdate(info({ status: "manual-download", hasUpdate: true }), true).message).toContain("simulated")
  expect(describeUpdate(info({ status: "manual-download", hasUpdate: true }), false).message).toContain("browser")
})

it("surfaces the update error message when one is present", () => {
  expect(describeUpdate(info({ status: "error", errorMessage: "Signature rejected" }), false).message).toBe("Signature rejected")
  expect(describeUpdate(info({ status: "error", errorMessage: null }), false).message).toBe("Could not complete the update.")
  expect(describeUpdate(info({ status: "up-to-date" }), false).message).toContain("latest version")
})
