import { Schema } from "effect"
import { Board, clampZoom, exportDocument, fitBoards, previewDocument, zoomAt, type BoardPatch, type Camera } from "../workspace/model"
import { createTokenPanel } from "./tokens"
import { AgentFormat, buildAgentPrompt } from "./agentPrompt"
import { createDOMPreview } from "./preview"
import { canvasRow, emptyLibraryMessage, visibleCanvases } from "./library"
import { describeUpdate } from "./updateView"
import { tokenReferences, type DesignToken } from "../workspace/tokens"
import { BLANK_HTML } from "../workspace/templates"
import { WorkspaceState, StreamedWorkspaceState, mergeStreamedState } from "../workspace/protocol"

declare global {
  interface Window {
    webkit?: { messageHandlers?: { blackboard?: { postMessage: (value: unknown) => void } } }
    blackboardHasUnsavedChanges?: () => boolean
  }
}
function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) throw new Error(`Missing workspace element: ${id}`)
  return found as T
}
const icons = {
  select: '<path d="m5 3 13 9-7 1-3 6z"/>',
  hand: '<path d="M8 11V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-3a1.5 1.5 0 0 1 3 0v5c0 5-3 7-7 7-3 0-5-2-7-5l-3-4c-1-2 1-3 2-2l3 3"/>',
  frame: '<path d="M7 2v20M17 2v20M2 7h20M2 17h20"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  preview: '<path d="m9 5 10 7-10 7z"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/>',
  export: '<path d="M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  update: '<path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4"/>'
}
const icon = (value: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${value}</svg>`
for (const [id, value] of Object.entries({
  "updates-button": icons.update,
  "zoom-fit": icons.fit,
  "preview-board": icons.preview,
  "duplicate-board": icons.duplicate,
  "export-board": icons.export,
  "delete-board": icons.trash
}))
  element(id).innerHTML = icon(value)
for (const [name, value] of Object.entries({ select: icons.select, hand: icons.hand, frame: icons.frame })) {
  const button = document.querySelector<HTMLButtonElement>(`[data-tool="${name}"]`)
  if (button) button.innerHTML = icon(value)
}
if (window.webkit?.messageHandlers?.blackboard) document.documentElement.classList.add("native")

const viewport = element("viewport")
const world = element("world")
const source = element<HTMLTextAreaElement>("html-source")
let state: WorkspaceState | undefined
let camera: Camera = { x: 80, y: 110, zoom: 0.8 }
let selectedId: string | null = null
let inspectorMode: "canvas" | "token" | "agent" | null = "canvas"
let libraryTab: "canvases" | "tokens" = "canvases"
let previewTokens: readonly DesignToken[] | undefined
let previewRevision = 0
let propertySaving = false
let awaitingAgent = false
let layoutReady = false
const currentTokens = () => previewTokens ?? state?.workspace.tokens
const tokensKey = () => `${state?.workspace.tokensRevision}:${previewRevision}`
let tool: "select" | "hand" | "frame" = "select"
let space = false
let connected = true
let pendingWrites = 0
let saveError = false
let editor: { id: string; revision: number; dirty: boolean } | null = null
window.blackboardHasUnsavedChanges = () => Boolean(editor?.dirty || tokenPanel.hasUnsavedChanges() || pendingWrites)
let toastTimer: ReturnType<typeof setTimeout>
let liveTimer: ReturnType<typeof setTimeout>
const views = new Map<string, { node: HTMLElement; preview: ReturnType<typeof createDOMPreview>; html: string; tokensRevision: string }>()
const canvasRows = new Map<string, HTMLButtonElement>()
type HistoryEntry = { before: Board | null; after: Board | null; id: string; revision: number }
const undoStack: HistoryEntry[] = []
const redoStack: HistoryEntry[] = []
const selected = () => state?.workspace.boards.find(b => b.id === selectedId)
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c)
function toast(message: string) {
  clearTimeout(toastTimer)
  element("toast").textContent = message
  element("toast").hidden = false
  toastTimer = setTimeout(() => {
    element("toast").hidden = true
  }, 4000)
}
function renderSaveState() {
  element("save-state").textContent = !connected ? "Reconnecting…" : saveError ? "Not saved" : pendingWrites ? "Saving…" : "Saved locally"
  element("save-state").classList.toggle("unsaved", saveError)
}
async function api(path: string, body?: unknown): Promise<unknown> {
  const savesWorkspace = body !== undefined && !path.startsWith("updates/")
  if (savesWorkspace) {
    pendingWrites++
    renderSaveState()
  }
  try {
    const response = await fetch(
      `/api/${path}`,
      body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    )
    const json: unknown = await response.json()
    if (!response.ok)
      throw new Error(
        typeof json === "object" && json && "error" in json && typeof json.error === "string"
          ? json.error
          : "The change could not be saved."
      )
    saveError = false
    return json
  } catch (error) {
    if (savesWorkspace) saveError = true
    throw error
  } finally {
    if (savesWorkspace) pendingWrites--
    renderSaveState()
  }
}
const perform = (action: () => Promise<unknown>) => {
  void action().catch(error => toast(error instanceof Error ? error.message : "The action failed."))
}
async function refresh() {
  acceptState(Schema.decodeUnknownSync(WorkspaceState)(await api("state")))
}
function acceptState(next: WorkspaceState) {
  const before = state
  state = next
  if (awaitingAgent && before && JSON.stringify(next.workspace.boards) !== JSON.stringify(before.workspace.boards)) {
    awaitingAgent = false
    element("agent-handoff-state").textContent = "Canvas updated. Select it in the library to review."
    element("agent-handoff-state").classList.add("copied")
    const added = next.workspace.boards.filter(board => !before.workspace.boards.some(previous => previous.id === board.id))
    if (added.length) fit(added)
    toast("New design changes arrived in your workspace")
  }
  if (document.activeElement !== element("workspace-name")) element<HTMLInputElement>("workspace-name").value = next.workspace.name
  renderBoards()
  renderUpdate()
  renderPreview()
  if (editor && !editor.dirty) {
    const current = next.workspace.boards.find(b => b.id === editor?.id)
    if (current && current.revision !== editor.revision) loadEditor(current)
  }
  if (selectedId && !next.workspace.boards.some(b => b.id === selectedId)) {
    selectedId = null
    if (editor?.dirty) {
      element("editor-error").hidden = false
      element("editor-error").textContent = "This canvas was removed elsewhere. Copy your draft before closing."
    } else closeEditor()
  }
  renderSelection()
  renderLibrary()
  renderInspector()
  renderSaveState()
  tokenPanel.update()
}
function renderCamera() {
  world.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`
  viewport.style.backgroundSize = `${20 * camera.zoom}px ${20 * camera.zoom}px`
  viewport.style.backgroundPosition = `${camera.x}px ${camera.y}px`
  element("zoom-value").textContent = `${Math.round(camera.zoom * 100)}%`
  try {
    localStorage.setItem("blackboard-camera", JSON.stringify(camera))
  } catch {}
}
function fit(boards = state?.workspace.boards ?? []) {
  camera = fitBoards(boards, viewport.clientWidth, viewport.clientHeight)
  renderCamera()
}
function setZoom(zoom: number, point = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }) {
  camera = zoomAt(camera, zoom, point)
  renderCamera()
}
function setTool(next: typeof tool) {
  tool = next
  viewport.classList.toggle("hand", tool === "hand" || space)
  viewport.classList.toggle("drawing", tool === "frame")
  document.querySelectorAll<HTMLElement>("[data-tool]").forEach(button => {
    button.classList.toggle("active", button.dataset.tool === next)
    button.setAttribute("aria-pressed", String(button.dataset.tool === next))
  })
}
function renderBoards() {
  if (!state) return
  const ids = new Set(state.workspace.boards.map(b => b.id))
  for (const [id, view] of views)
    if (!ids.has(id)) {
      view.preview.dispose()
      view.node.remove()
      views.delete(id)
    }
  for (const [index, board] of state.workspace.boards.entries()) {
    let view = views.get(board.id)
    if (!view) {
      const node = document.createElement("section")
      node.className = "board"
      node.dataset.id = board.id
      node.setAttribute("aria-label", board.name)
      node.innerHTML =
        '<div class="board-label"><span class="board-number"></span><span class="board-title"></span><span class="board-size"></span></div><div class="board-surface"></div><button class="resize-handle" aria-label="Resize canvas"></button>'
      const surface = node.querySelector<HTMLElement>(".board-surface")
      if (!surface) throw new Error("Missing canvas preview surface")
      world.append(node)
      view = { node, preview: createDOMPreview(surface), html: "", tokensRevision: "" }
      views.set(board.id, view)
    }
    view.node.classList.toggle("selected", board.id === selectedId)
    view.node.style.cssText = `left:${board.x}px;top:${board.y}px;width:${board.width}px;height:${board.height}px`
    view.node.setAttribute("aria-label", board.name)
    const number = view.node.querySelector(".board-number")
    if (number) number.textContent = String(index + 1).padStart(2, "0")
    const title = view.node.querySelector(".board-title")
    if (title) title.textContent = board.name
    const size = view.node.querySelector(".board-size")
    if (size) size.textContent = `${Math.round(board.width)} × ${Math.round(board.height)}`
    const content = editor?.id === board.id && editor.dirty ? source.value : board.html
    if (view.html !== content || view.tokensRevision !== tokensKey()) {
      view.preview.render(previewDocument(content, currentTokens()), board.name)
      view.html = content
      view.tokensRevision = tokensKey()
    }
  }
  element("empty").hidden = state.workspace.boards.length !== 0
}
function renderSelection() {
  const board = selected()
  element("selection-bar").hidden = !board
  element("selected-name").textContent = board?.name ?? ""
  for (const [id, view] of views) view.node.classList.toggle("selected", id === selectedId)
}
function select(id: string | null) {
  if (id !== selectedId && editor?.dirty && !window.confirm("Discard your unsaved HTML draft?")) return false
  if (id !== selectedId && editor) closeEditor(true)
  selectedId = id
  inspectorMode = id ? "canvas" : state?.workspace.boards.length ? "canvas" : "agent"
  renderSelection()
  renderLibrary()
  renderInspector()
  return true
}
function loadEditor(board: Board) {
  editor = { id: board.id, revision: board.revision, dirty: false }
  element("editor-title").textContent = board.name
  element<HTMLInputElement>("board-name").value = board.name
  element<HTMLInputElement>("board-width").value = String(board.width)
  element<HTMLInputElement>("board-height").value = String(board.height)
  source.value = board.html
  element("draft-state").textContent = "Saved"
  element("editor-error").hidden = true
}
function openEditor() {
  const board = selected()
  if (!board) return
  if (editor?.id !== board.id) loadEditor(board)
  element("editor").hidden = false
  document.body.classList.add("editing")
  renderInspector()
  fit([board])
}
function closeEditor(force = false) {
  if (!force && editor?.dirty && !window.confirm("Discard your unsaved HTML draft?")) return false
  clearTimeout(liveTimer)
  const id = editor?.id
  editor = null
  element("editor").hidden = true
  document.body.classList.remove("editing")
  if (id) {
    const view = views.get(id)
    if (view) view.html = ""
  }
  renderBoards()
  renderInspector()
  return true
}
function markDirty() {
  if (!editor) return
  editor.dirty = true
  element("draft-state").textContent = "Unsaved draft"
  clearTimeout(liveTimer)
  liveTimer = setTimeout(() => {
    const view = editor && views.get(editor.id)
    if (view) {
      view.preview.render(
        previewDocument(source.value, currentTokens()),
        editor?.id === selectedId ? (selected()?.name ?? "Canvas") : "Canvas"
      )
      view.html = source.value
    }
  }, 180)
}
function remember(before: Board | null, after: Board | null) {
  const board = after ?? before
  if (!board) return
  undoStack.push({ before, after, id: board.id, revision: board.revision })
  if (undoStack.length > 60) undoStack.shift()
  redoStack.length = 0
}
async function updateBoard(board: Board, patch: BoardPatch) {
  const after = Schema.decodeUnknownSync(Board)(
    await api(`boards/${encodeURIComponent(board.id)}`, { ...patch, expectedRevision: board.revision })
  )
  remember(board, after)
  if (
    editor?.id === board.id &&
    editor.dirty &&
    patch.html === undefined &&
    patch.name === undefined &&
    patch.width === undefined &&
    patch.height === undefined
  )
    editor.revision = after.revision
  await refresh()
  return after
}
async function saveSource() {
  if (!editor || !state) return
  const before = state.workspace.boards.find(b => b.id === editor?.id)
  if (!before) throw new Error("This canvas no longer exists. Copy your draft before closing.")
  const button = element<HTMLButtonElement>("save-source")
  button.disabled = true
  try {
    const after = Schema.decodeUnknownSync(Board)(
      await api(`boards/${encodeURIComponent(editor.id)}`, {
        html: source.value,
        name: element<HTMLInputElement>("board-name").value.trim(),
        width: Number(element<HTMLInputElement>("board-width").value),
        height: Number(element<HTMLInputElement>("board-height").value),
        expectedRevision: editor.revision
      })
    )
    remember(before, after)
    loadEditor(after)
    await refresh()
    toast("Canvas saved")
  } catch (error) {
    element("editor-error").hidden = false
    element("editor-error").textContent = error instanceof Error ? error.message : "Could not save this draft."
  } finally {
    button.disabled = false
  }
}
async function createBoard(input?: { x: number; y: number; width: number; height: number }) {
  if (!select(null)) return
  const bounds = input ?? {
    x: (viewport.clientWidth / 2 - camera.x) / camera.zoom - 380,
    y: (viewport.clientHeight / 2 - camera.y) / camera.zoom - 280,
    width: 760,
    height: 560
  }
  const board = Schema.decodeUnknownSync(Board)(
    await api("boards", { name: `Untitled canvas ${(state?.workspace.boards.length ?? 0) + 1}`, html: BLANK_HTML, ...bounds })
  )
  remember(null, board)
  await refresh()
  select(board.id)
  setTool("select")
  fit([board])
}
async function duplicateBoard() {
  const before = selected()
  if (!before || !select(null)) return
  const { id, revision, ...fields } = before
  const board = Schema.decodeUnknownSync(Board)(
    await api("boards", { ...fields, name: `${fields.name.slice(0, 112)} copy`, x: fields.x + fields.width + 64 })
  )
  remember(null, board)
  await refresh()
  select(board.id)
  fit()
}
async function deleteBoard() {
  const before = selected()
  if (!before || !select(null)) return
  await api(`boards/${encodeURIComponent(before.id)}/delete`, { expectedRevision: before.revision })
  remember(before, null)
  await refresh()
  toast("Canvas deleted · ⌘ Z to undo")
}
async function historyStep(redo = false) {
  if (editor?.dirty) return
  const from = redo ? redoStack : undoStack,
    to = redo ? undoStack : redoStack
  const entry = from.at(-1)
  if (!entry) return
  const desired = redo ? entry.after : entry.before
  const existing = state?.workspace.boards.find(b => b.id === entry.id)
  const expected = redo ? entry.before : entry.after
  if (existing && expected) {
    const { id: existingId, revision: existingRevision, ...currentFields } = existing
    const { id: expectedId, revision: expectedRevision, ...expectedFields } = expected
    if (JSON.stringify(currentFields) !== JSON.stringify(expectedFields))
      throw new Error("This canvas changed elsewhere. Undo is paused to preserve those changes.")
  }
  if (!desired) {
    if (existing) await api(`boards/${encodeURIComponent(entry.id)}/delete`, { expectedRevision: existing.revision })
  } else {
    const { id, revision, ...fields } = desired
    const after = Schema.decodeUnknownSync(Board)(
      await api(
        existing ? `boards/${encodeURIComponent(entry.id)}` : "boards",
        existing ? { ...fields, expectedRevision: existing.revision } : { ...fields, id: entry.id }
      )
    )
    entry.id = after.id
    entry.revision = after.revision
  }
  from.pop()
  to.push(entry)
  await refresh()
  if (desired) select(entry.id)
}
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const field = document.createElement("textarea")
    field.value = value
    document.body.append(field)
    field.select()
    const success = document.execCommand("copy")
    field.remove()
    if (!success) throw new Error("Clipboard unavailable. Select and copy the text manually.")
  }
}
function exportBoard() {
  if (window.blackboardHasUnsavedChanges?.()) {
    toast("Save your drafts before exporting.")
    return
  }
  const board = selected()
  if (!board) return
  const html = exportDocument(board.html, board.name, state?.workspace.tokens)
  const filename = `${board.name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "canvas"}.html`
  const bridge = window.webkit?.messageHandlers?.blackboard
  if (bridge) bridge.postMessage({ type: "export", filename, html })
  else {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }))
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
let previewId: string | null = null
let fullPreview: ReturnType<typeof createDOMPreview> | undefined
let fullPreviewSurface: HTMLElement | undefined
function renderPreview() {
  const dialog = element<HTMLDialogElement>("preview-dialog")
  if (!dialog.open) return
  const board = state?.workspace.boards.find(board => board.id === previewId)
  if (!board) {
    dialog.close()
    return
  }
  if (!fullPreview || !fullPreviewSurface) return
  element("preview-name").textContent = `${board.name} · ${board.width} × ${board.height}`
  fullPreviewSurface.style.width = `${board.width}px`
  fullPreviewSurface.style.height = `${board.height}px`
  const html = previewDocument(editor?.dirty && editor.id === board.id ? source.value : board.html, currentTokens())
  fullPreview.render(html, `${board.name} preview`)
}
function showPreview() {
  const board = selected()
  if (!board) return
  previewId = board.id
  element("preview-name").textContent = `${board.name} · ${board.width} × ${board.height}`
  fullPreview?.dispose()
  fullPreviewSurface = document.createElement("div")
  fullPreviewSurface.className = "preview-surface"
  fullPreviewSurface.style.width = `${board.width}px`
  fullPreviewSurface.style.height = `${board.height}px`
  fullPreview = createDOMPreview(fullPreviewSurface)
  fullPreview.render(
    previewDocument(editor?.dirty && editor.id === board.id ? source.value : board.html, currentTokens()),
    `${board.name} preview`
  )
  element("preview-holder").replaceChildren(fullPreviewSurface)
  element<HTMLDialogElement>("preview-dialog").showModal()
}
element<HTMLDialogElement>("preview-dialog").addEventListener("close", () => {
  fullPreview?.dispose()
  fullPreview = undefined
  fullPreviewSurface = undefined
  previewId = null
  element("preview-holder").replaceChildren()
})
function activateLibrary(tab: typeof libraryTab) {
  libraryTab = tab
  document.body.classList.remove("library-collapsed")
  element("library").hidden = false
  element("library-toggle").setAttribute("aria-expanded", "true")
  element("canvases-panel").hidden = tab !== "canvases"
  element("tokens-sidebar").hidden = tab !== "tokens"
  element("canvases-button").setAttribute("aria-selected", String(tab === "canvases"))
  element("tokens-button").setAttribute("aria-selected", String(tab === "tokens"))
  element("canvases-button").tabIndex = tab === "canvases" ? 0 : -1
  element("tokens-button").tabIndex = tab === "tokens" ? 0 : -1
  if (tab === "tokens") tokenPanel.update()
}
function activateInspector(mode: typeof inspectorMode) {
  if (editor && !closeEditor()) return false
  inspectorMode = mode
  renderInspector()
  return true
}
function renderLibrary() {
  if (!state) return
  element("canvas-total").textContent = String(state.workspace.boards.length)
  element("token-total").textContent = String(state.workspace.tokens.length)
  element("app-version").textContent = `v${state.version}`
  element("stage-label").textContent = state.workspace.boards.length ? "DESIGN EXPLORATIONS" : "YOUR WORKSPACE"
  element("stage-count").textContent = `${state.workspace.boards.length} canvas${state.workspace.boards.length === 1 ? "" : "es"}`
  const list = element("canvas-list")
  const query = element<HTMLInputElement>("canvas-search").value
  const boards = visibleCanvases(state.workspace.boards, query)
  const visible = new Set(boards.map(board => board.id))
  for (const board of boards) {
    let row = canvasRows.get(board.id)
    if (!row) {
      row = document.createElement("button")
      row.className = "canvas-row"
      row.type = "button"
      row.innerHTML = '<span class="canvas-icon"></span><span class="canvas-label"></span><small></small>'
      const id = board.id
      row.addEventListener("click", () => {
        const current = state?.workspace.boards.find(candidate => candidate.id === id)
        if (current && select(current.id)) fit([current])
      })
      canvasRows.set(board.id, row)
    }
    const model = canvasRow(board, selectedId)
    row.classList.toggle("active", model.active)
    row.setAttribute("aria-label", `Select ${model.label}`)
    row.setAttribute("aria-pressed", String(model.active))
    const icon = row.querySelector(".canvas-icon")
    if (icon) icon.textContent = model.icon
    const label = row.querySelector(".canvas-label")
    if (label) label.textContent = model.label
    const size = row.querySelector("small")
    if (size) size.textContent = model.size
    list.append(row)
  }
  for (const [id, row] of canvasRows)
    if (!visible.has(id)) {
      row.remove()
      canvasRows.delete(id)
    }
  const existingEmpty = list.querySelector<HTMLElement>(".library-empty")
  if (!boards.length) {
    const message = emptyLibraryMessage(query)
    if (existingEmpty) existingEmpty.textContent = message
    else {
      const empty = document.createElement("p")
      empty.className = "library-empty"
      empty.textContent = message
      list.append(empty)
    }
  } else existingEmpty?.remove()
  element<HTMLButtonElement>("undo-button").disabled = !undoStack.length
  element<HTMLButtonElement>("redo-button").disabled = !redoStack.length
}
function renderInspector() {
  const board = selected()
  document.body.classList.toggle("inspector-hidden", !editor && inspectorMode === null)
  element("canvas-inspector").hidden = Boolean(editor) || inspectorMode !== "canvas"
  element("token-inspector").hidden = Boolean(editor) || inspectorMode !== "token"
  element("agent-panel").hidden = Boolean(editor) || inspectorMode !== "agent"
  element("no-selection").hidden = Boolean(board)
  element("canvas-properties").hidden = !board
  for (const id of ["header-preview", "header-export"]) element<HTMLButtonElement>(id).disabled = !board
  element("agent-button").setAttribute("aria-pressed", String(inspectorMode === "agent" && !editor))
  element("agent-command").textContent = state
    ? [state.agent.command, ...state.agent.args].map(value => (/\s/.test(value) ? JSON.stringify(value) : value)).join(" ")
    : ""
  element("agent-token-count").textContent = `◈ ${state?.workspace.tokens.length ?? 0} shared tokens`
  element("agent-target").textContent = board ? `Canvas: ${board.name}` : "New canvases"
  if (!board) return
  element("inspector-name").textContent = board.name
  const values = {
    "property-name": board.name,
    "property-x": board.x,
    "property-y": board.y,
    "property-width": board.width,
    "property-height": board.height
  }
  for (const [id, value] of Object.entries(values)) {
    const input = element<HTMLInputElement>(id)
    if (document.activeElement !== input) input.value = String(value)
    input.disabled = propertySaving
  }
  element<HTMLSelectElement>("canvas-preset").disabled = propertySaving
  if (document.activeElement !== element("canvas-preset"))
    element<HTMLSelectElement>("canvas-preset").value =
      board.width === 1440 && board.height === 900
        ? "desktop"
        : board.width === 390 && board.height === 844
          ? "mobile"
          : board.width === 768 && board.height === 1024
            ? "tablet"
            : "custom"
  element("source-snippet").textContent =
    board.html.length > 200 ? `${board.html.slice(0, 200)}…` : board.html || "This canvas is ready for your HTML."
  const references = tokenReferences(board.html)
  element("used-token-count").textContent = String(references.length)
  const used = element("used-tokens")
  used.replaceChildren()
  for (const name of references) {
    const chip = document.createElement("button")
    chip.className = "token-chip"
    chip.textContent = `◈ ${name}`
    chip.addEventListener("click", () => tokenPanel.selectToken(name))
    used.append(chip)
  }
  if (!references.length) {
    const text = document.createElement("p")
    text.textContent = "Use var(--token-name) in your CSS to link this canvas to your design system."
    used.append(text)
  }
}
async function changeProperty(patch: BoardPatch) {
  const board = selected()
  if (!board || propertySaving) return
  propertySaving = true
  renderInspector()
  element("property-error").hidden = true
  try {
    await updateBoard(board, patch)
  } catch (cause) {
    element("property-error").textContent = cause instanceof Error ? cause.message : "Could not save this canvas."
    element("property-error").hidden = false
  } finally {
    propertySaving = false
    renderInspector()
  }
}
function showAgent() {
  if (activateInspector("agent")) element("agent-brief").focus()
}
function startDesign(format: "website" | "mobile") {
  if (!select(null)) return
  element<HTMLSelectElement>("agent-format").value = format === "website" ? "responsive" : "mobile"
  const brief = element<HTMLTextAreaElement>("agent-brief")
  if (!brief.value.trim())
    brief.value =
      format === "website"
        ? "Design a thoughtful website with a matching mobile version. Reuse my shared design tokens."
        : "Design a focused mobile app screen. Reuse my shared design tokens."
  showAgent()
}

type Gesture =
  | { kind: "pan"; x: number; y: number; camera: Camera }
  | { kind: "move" | "resize"; x: number; y: number; board: Board }
  | { kind: "draw"; x: number; y: number }
let gesture: Gesture | null = null
const localPoint = (event: { clientX: number; clientY: number }) => {
  const rect = viewport.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}
function drawBounds(x: number, y: number, endX: number, endY: number) {
  return {
    x: (Math.min(x, endX) - camera.x) / camera.zoom,
    y: (Math.min(y, endY) - camera.y) / camera.zoom,
    width: Math.max(120, Math.abs(endX - x) / camera.zoom),
    height: Math.max(120, Math.abs(endY - y) / camera.zoom)
  }
}
viewport.addEventListener("pointerdown", event => {
  if (event.button !== 0 && event.button !== 1) return
  const interactive = event.target instanceof Element ? event.target.closest("button,input,select,textarea") : null
  if (interactive && !interactive.classList.contains("resize-handle")) return
  const point = localPoint(event)
  if (space || tool === "hand" || event.button === 1) {
    gesture = { kind: "pan", x: event.clientX, y: event.clientY, camera }
    viewport.classList.add("panning")
  } else if (tool === "frame") {
    gesture = { kind: "draw", ...point }
    element("draw-ghost").hidden = false
  } else {
    const target = event.target instanceof Element ? event.target : null
    const id = target?.closest<HTMLElement>(".board")?.dataset.id
    const board = state?.workspace.boards.find(b => b.id === id)
    if (!select(board?.id ?? null)) return
    if (board) gesture = { kind: target?.closest(".resize-handle") ? "resize" : "move", x: event.clientX, y: event.clientY, board }
  }
  if (gesture) {
    viewport.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
})
viewport.addEventListener("pointermove", event => {
  if (!gesture) return
  if (gesture.kind === "pan") {
    camera = { ...gesture.camera, x: gesture.camera.x + event.clientX - gesture.x, y: gesture.camera.y + event.clientY - gesture.y }
    renderCamera()
  } else if (gesture.kind === "draw") {
    const point = localPoint(event)
    const bounds = drawBounds(gesture.x, gesture.y, point.x, point.y)
    element("draw-ghost").style.cssText =
      `left:${bounds.x * camera.zoom + camera.x}px;top:${bounds.y * camera.zoom + camera.y}px;width:${bounds.width * camera.zoom}px;height:${bounds.height * camera.zoom}px`
  } else {
    const view = views.get(gesture.board.id)
    if (!view) return
    const dx = (event.clientX - gesture.x) / camera.zoom,
      dy = (event.clientY - gesture.y) / camera.zoom
    if (gesture.kind === "move") {
      view.node.style.left = `${gesture.board.x + dx}px`
      view.node.style.top = `${gesture.board.y + dy}px`
    } else {
      view.node.style.width = `${Math.max(120, Math.min(6000, gesture.board.width + dx))}px`
      view.node.style.height = `${Math.max(120, Math.min(6000, gesture.board.height + dy))}px`
    }
  }
})
function endGesture(event: PointerEvent, cancelled = false) {
  const current = gesture
  gesture = null
  viewport.classList.remove("panning")
  element("draw-ghost").hidden = true
  if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
  if (!current || current.kind === "pan") return
  if (cancelled) {
    renderBoards()
    return
  }
  const dx = (event.clientX - current.x) / camera.zoom,
    dy = (event.clientY - current.y) / camera.zoom
  if (current.kind === "draw") {
    const point = localPoint(event)
    perform(() => createBoard(drawBounds(current.x, current.y, point.x, point.y)))
    return
  }
  if (Math.abs(dx) + Math.abs(dy) < 2) return
  const board = current.board
  const patch =
    current.kind === "move"
      ? { x: Math.round(board.x + dx), y: Math.round(board.y + dy) }
      : {
          width: Math.round(Math.max(120, Math.min(6000, board.width + dx))),
          height: Math.round(Math.max(120, Math.min(6000, board.height + dy)))
        }
  perform(async () => {
    try {
      await updateBoard(board, patch)
    } finally {
      renderBoards()
    }
  })
}
viewport.addEventListener("pointerup", event => endGesture(event))
viewport.addEventListener("pointercancel", event => endGesture(event, true))
viewport.addEventListener("dblclick", () => {
  if (selected()) openEditor()
})
viewport.addEventListener(
  "wheel",
  event => {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey) setZoom(camera.zoom * Math.exp(-event.deltaY * 0.01), localPoint(event))
    else {
      camera = { ...camera, x: camera.x - event.deltaX, y: camera.y - event.deltaY }
      renderCamera()
    }
  },
  { passive: false }
)
document.addEventListener("keydown", event => {
  const typing =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement ||
    (event.target instanceof HTMLElement && event.target.isContentEditable)
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault()
    if (document.body.classList.contains("library-collapsed")) element("library-toggle").click()
    element(libraryTab === "tokens" ? "token-search" : "canvas-search").focus()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && editor) {
    event.preventDefault()
    perform(saveSource)
    return
  }
  if (typing || document.querySelector("dialog[open]")) return
  const command = event.metaKey || event.ctrlKey
  if (event.code === "Space") {
    event.preventDefault()
    space = true
    viewport.classList.add("hand")
  } else if (command && event.key.toLowerCase() === "d") {
    event.preventDefault()
    perform(duplicateBoard)
  } else if (command && event.key.toLowerCase() === "z") {
    event.preventDefault()
    perform(() => historyStep(event.shiftKey))
  } else if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault()
    perform(deleteBoard)
  } else if (event.key === "Escape") {
    if (closeEditor()) select(null)
    setTool("select")
  } else if (event.shiftKey && event.code === "Digit1") fit()
  else if (command && ["+", "=", "-", "0"].includes(event.key)) {
    event.preventDefault()
    setZoom(event.key === "0" ? 1 : camera.zoom * (event.key === "-" ? 0.8 : 1.25))
  } else if (!command && event.key.toLowerCase() === "v") setTool("select")
  else if (!command && event.key.toLowerCase() === "h") setTool("hand")
  else if (!command && event.key.toLowerCase() === "a") setTool("frame")
})
document.addEventListener("keyup", event => {
  if (event.code === "Space") {
    space = false
    viewport.classList.toggle("hand", tool === "hand")
  }
})
window.addEventListener("blur", () => {
  space = false
  viewport.classList.toggle("hand", tool === "hand")
})
window.addEventListener("beforeunload", event => {
  if (window.blackboardHasUnsavedChanges?.()) {
    event.preventDefault()
    event.returnValue = ""
  }
})
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]"))
  button.addEventListener("click", () => {
    const value = button.dataset.tool
    if (value === "select" || value === "hand" || value === "frame") setTool(value)
  })
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-close]"))
  button.addEventListener("click", () => element<HTMLDialogElement>(button.dataset.close ?? "").close())
const tokenPanel = createTokenPanel({
  workspace: () => state?.workspace,
  request: api,
  refresh,
  copy,
  notify: toast,
  onInspect: () => activateInspector("token"),
  onClose: () => {
    activateInspector(selected() ? "canvas" : "agent")
  },
  onLibrary: () => activateLibrary("tokens"),
  onSelectBoard: id => {
    if (select(id)) {
      const board = selected()
      if (board) fit([board])
    }
  },
  onPreview: tokens => {
    if (previewTokens === tokens) return
    previewTokens = tokens
    previewRevision++
    element("token-preview-banner").hidden = !tokens
    renderBoards()
    renderPreview()
  }
})
const actions: Record<string, () => void> = {
  "add-board": () => perform(() => createBoard()),
  "empty-add": () => perform(() => createBoard()),
  "library-new": () => perform(() => createBoard()),
  "tool-new": () => perform(() => createBoard()),
  "header-preview": showPreview,
  "header-export": exportBoard,
  "inspector-edit": openEditor,
  "inspector-agent": showAgent,
  "tool-agent": showAgent,
  "no-selection-agent": showAgent,
  "close-agent": () => {
    activateInspector("canvas")
  },
  "collapse-inspector": () => {
    activateInspector(null)
  },
  "undo-button": () => perform(() => historyStep()),
  "redo-button": () => perform(() => historyStep(true)),
  "canvases-button": () => activateLibrary("canvases"),
  "review-token-draft": () => tokenPanel.revealDraft(),
  "library-toggle": () => {
    const collapsed = document.body.classList.toggle("library-collapsed")
    element("library").hidden = collapsed
    element("library-toggle").setAttribute("aria-expanded", String(!collapsed))
  },
  "zoom-in": () => setZoom(camera.zoom * 1.25),
  "zoom-out": () => setZoom(camera.zoom * 0.8),
  "zoom-value": () => setZoom(1),
  "zoom-fit": () => fit(),
  "edit-board": openEditor,
  "close-editor": () => {
    closeEditor()
  },
  "save-source": () => perform(saveSource),
  "duplicate-board": () => perform(duplicateBoard),
  "delete-board": () => perform(deleteBoard),
  "preview-board": showPreview,
  "export-board": exportBoard,
  "agent-button": showAgent,
  "copy-config": () =>
    perform(async () => {
      if (!state) return
      await copy(JSON.stringify({ mcpServers: { blackboard: state.agent } }, null, 2))
      toast("MCP configuration copied")
    }),
  "copy-brief": () =>
    perform(async () => {
      if (window.blackboardHasUnsavedChanges?.()) {
        toast("Save or discard your drafts before handing this canvas to your agent.")
        return
      }
      const brief = element<HTMLTextAreaElement>("agent-brief").value.trim()
      if (!brief) {
        element("agent-brief").focus()
        return
      }
      const board = selected()
      const format = Schema.decodeUnknownSync(AgentFormat)(element<HTMLSelectElement>("agent-format").value)
      await copy(buildAgentPrompt(brief, format, board))
      awaitingAgent = true
      element("agent-handoff-state").textContent = "Prompt copied. Paste it into your agent; results will appear here."
      element("agent-handoff-state").classList.add("copied")
      toast("Prompt copied. Ready for your connected agent.")
    }),
  "updates-button": () => {
    element<HTMLDialogElement>("update-dialog").showModal()
    if (state && ["idle", "up-to-date", "error"].includes(state.update.status)) perform(() => updateAction("check"))
  }
}
for (const [id, action] of Object.entries(actions)) element(id).addEventListener("click", action)
element("canvas-search").addEventListener("input", renderLibrary)
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-starter]"))
  button.addEventListener("click", () => startDesign(button.dataset.starter === "mobile" ? "mobile" : "website"))
for (const [id, key] of Object.entries({
  "property-name": "name",
  "property-x": "x",
  "property-y": "y",
  "property-width": "width",
  "property-height": "height"
})) {
  element<HTMLInputElement>(id).addEventListener("change", event => {
    const input = event.currentTarget
    if (!(input instanceof HTMLInputElement) || !input.reportValidity()) return
    perform(() => changeProperty({ [key]: key === "name" ? input.value.trim() : Number(input.value) }))
  })
}
element<HTMLSelectElement>("canvas-preset").addEventListener("change", event => {
  if (!(event.currentTarget instanceof HTMLSelectElement)) return
  const preset = event.currentTarget.value
  if (preset === "desktop") perform(() => changeProperty({ width: 1440, height: 900 }))
  if (preset === "mobile") perform(() => changeProperty({ width: 390, height: 844 }))
  if (preset === "tablet") perform(() => changeProperty({ width: 768, height: 1024 }))
})
for (const id of ["board-name", "board-width", "board-height", "html-source"]) element(id).addEventListener("input", markDirty)
source.addEventListener("keydown", event => {
  if (event.key === "Tab") {
    event.preventDefault()
    source.setRangeText("  ", source.selectionStart, source.selectionEnd, "end")
    markDirty()
  }
})
element("workspace-name").addEventListener("change", () =>
  perform(async () => {
    await api("workspace", { name: element<HTMLInputElement>("workspace-name").value.trim() })
    await refresh()
  })
)

let updateBusy = false
async function updateAction(action: "check" | "install" | "restart" | "download" | "replay") {
  if (updateBusy) return
  if (action === "restart" && window.blackboardHasUnsavedChanges?.()) {
    toast("Save your drafts before restarting.")
    return
  }
  updateBusy = true
  renderUpdate()
  try {
    await api(`updates/${action}`, {})
    if (action === "replay") await api("updates/check", {})
  } finally {
    updateBusy = false
    await refresh()
  }
}
function renderUpdate() {
  if (!state) return
  const info = state.update
  const preview = state.updatePreview
  const view = describeUpdate(info, preview)
  element("updates-button").classList.toggle("available", info.hasUpdate)
  element("updates-button").innerHTML =
    `${icon(icons.update)}<span>${info.hasUpdate ? (info.status === "ready-to-restart" ? "Restart to update" : "Update available") : info.status === "checking" ? "Checking for updates…" : info.status === "error" ? "Update check failed · Retry" : info.status === "up-to-date" ? "Blackboard is up to date" : "Check for updates"}</span>`
  element("updates-button").setAttribute(
    "aria-label",
    info.hasUpdate
      ? `${info.status === "ready-to-restart" ? "Restart to update" : "Update available"} · Blackboard ${info.latestVersion}`
      : "App updates"
  )
  element("updates-button").title = info.hasUpdate ? `Blackboard ${info.latestVersion} is available` : "App updates"
  element("update-title").textContent = view.title
  const working = view.working
  let buttons = ""
  if (!working) {
    if (info.status === "restarting" && preview)
      buttons =
        '<button data-update="replay" class="primary">Replay preview</button><button data-later class="quiet">Back to canvas</button>'
    else if (info.status === "ready-to-restart")
      buttons = '<button data-update="restart" class="primary">Restart now</button><button data-later class="quiet">Restart later</button>'
    else if (info.hasUpdate && info.canInstallAutomatically && info.status !== "manual-download")
      buttons = `<button data-update="install" class="primary">${info.status === "error" ? "Try again" : "Download and install"}</button><button data-update="download" class="quiet">Download DMG</button>`
    else
      buttons = `<button data-update="${info.hasUpdate || info.status === "manual-download" ? "download" : "check"}" class="primary">${info.hasUpdate || info.status === "manual-download" ? "Download DMG" : "Check for updates"}</button>`
  }
  const steps = info.hasUpdate
    ? `<div class="update-steps">${view.steps.map(step => `<div class="${step.state === "todo" ? "" : step.state}" ${step.state === "current" ? 'aria-current="step"' : ""}><span class="step-dot" aria-hidden="true">${escapeHtml(step.marker)}</span><span>${escapeHtml(step.label)}</span></div>`).join("")}</div>`
    : ""
  element("update-body").innerHTML =
    `${preview ? '<div class="preview-notice">INTERACTIVE PREVIEW <span>No files are downloaded or installed.</span></div>' : ""}${steps}<div class="update-status" role="status">${escapeHtml(view.message)}</div>${working ? '<div class="update-progress" role="progressbar" aria-label="Update in progress"></div>' : ""}${info.installHint && !info.canInstallAutomatically ? `<p style="font-size:10px;margin:6px 0">${escapeHtml(info.installHint)}</p>` : ""}${info.errorMessage && info.status !== "error" ? `<p role="alert">${escapeHtml(info.errorMessage)}</p>` : ""}<div class="update-actions">${buttons}</div><div class="update-version">Current version ${escapeHtml(info.currentVersion)}</div>`
  element("update-body")
    .querySelectorAll<HTMLButtonElement>("button")
    .forEach(button => {
      button.disabled = updateBusy
      button.addEventListener("click", () => {
        const action = button.dataset.update
        if (action === "check" || action === "install" || action === "restart" || action === "download" || action === "replay")
          perform(() => updateAction(action))
        else element<HTMLDialogElement>("update-dialog").close()
      })
    })
}

async function start() {
  await refresh()
  if (state?.workspace.boards.length) {
    const first = state.workspace.boards[0]
    if (first) select(first.id)
  } else activateInspector("agent")
  let width = viewport.clientWidth,
    height = viewport.clientHeight
  new ResizeObserver(() => {
    const nextWidth = viewport.clientWidth,
      nextHeight = viewport.clientHeight
    if (layoutReady) {
      camera = { ...camera, x: camera.x + (nextWidth - width) / 2, y: camera.y + (nextHeight - height) / 2 }
      renderCamera()
    }
    width = nextWidth
    height = nextHeight
  }).observe(viewport)
  try {
    const saved = localStorage.getItem("blackboard-camera")
    if (saved) {
      const value: unknown = JSON.parse(saved)
      const parsed = Schema.decodeUnknownSync(Schema.Struct({ x: Schema.Finite, y: Schema.Finite, zoom: Schema.Finite }))(value)
      camera = { ...parsed, zoom: clampZoom(parsed.zoom) }
      renderCamera()
    } else fit()
  } catch {
    fit()
  }
  layoutReady = true
  const events = new EventSource("/api/events")
  events.onopen = () => {
    connected = true
    renderSaveState()
    perform(refresh)
  }
  events.onmessage = event => {
    try {
      acceptState(mergeStreamedState(state, Schema.decodeUnknownSync(StreamedWorkspaceState)(JSON.parse(event.data))))
    } catch {
      toast("Could not read a workspace update. Reload Blackboard.")
    }
  }
  events.onerror = () => {
    connected = false
    renderSaveState()
  }
  if (state?.update.canInstallAutomatically) perform(() => updateAction("check"))
  setInterval(
    () => {
      if (state?.update.canInstallAutomatically) perform(() => updateAction("check"))
    },
    6 * 60 * 60 * 1000
  )
}
void start().catch(error => {
  element("fatal").textContent = error instanceof Error ? error.message : "Could not open the workspace."
  element("fatal").hidden = false
})
