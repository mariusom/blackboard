import { expect, it } from "bun:test"
import { Effect, ManagedRuntime } from "effect"
import { buildAgentPrompt } from "../src/web/agentPrompt"
import { WorkspaceService } from "../src/workspace/WorkspaceService"
import { previewTokenDraft, type DesignToken } from "../src/workspace/tokens"
import type { Board } from "../src/workspace/model"

it("starts a new workspace empty with a reusable token library", async () => {
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer())
  try {
    const workspace = await runtime.runPromise(Effect.flatMap(WorkspaceService, workspace => workspace.get))
    expect(workspace.boards).toEqual([])
    expect(workspace.tokens.length).toBeGreaterThan(0)
  } finally { await runtime.dispose() }
})

it("previews token drafts without modifying saved values and rejects invalid alias graphs", () => {
  const brand: DesignToken = { name: "brand", type: "color", value: "#112233" }
  const alias: DesignToken = { name: "action", type: "color", value: "var(--brand)" }
  const saved = [brand, alias]
  const preview = previewTokenDraft(saved, { ...brand, value: "#7966e8" }, false)
  expect(preview?.find(token => token.name === "brand")?.value).toBe("#7966e8")
  expect(saved[0]?.value).toBe("#112233")
  expect(previewTokenDraft(saved, brand, true)).toBeUndefined()
  expect(previewTokenDraft(saved, { ...brand, value: "var(--action)" }, false)).toBeUndefined()
  expect(previewTokenDraft(saved, { ...brand, value: "</style><script>" }, false)).toBeUndefined()
})

it("gives an agent the requested format and shared-token workflow for new designs", () => {
  const prompt = buildAgentPrompt("Build a studio website", "responsive")
  expect(prompt).toContain("separate desktop and mobile canvases")
  expect(prompt).toContain("canvas_list_tokens")
  expect(prompt).toContain("expectedRevision")
  expect(prompt).toContain("Preserve unrelated tokens and canvases")
  expect(buildAgentPrompt("A booking screen", "mobile")).toContain("mobile canvas")
})

it("keeps a selected canvas as the refinement target regardless of the new-canvas preset", () => {
  const board: Board = { id: "selected-board", name: 'Home "new"', html: "<h1>Keep</h1>", width: 900, height: 600, x: 0, y: 0, revision: 4 }
  const prompt = buildAgentPrompt("Refine the type", "responsive", board)
  expect(prompt).toContain("id: selected-board")
  expect(prompt).toContain("canvas_get_board")
  expect(prompt).toContain("preserve its dimensions")
  expect(prompt).not.toContain("Create separate desktop and mobile canvases")
})
