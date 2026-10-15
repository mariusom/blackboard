import { Schema } from "effect"
import { Board, clampZoom, exportDocument, fitBoards, previewDocument, zoomAt, type BoardPatch, type Camera } from "../workspace/model"
import { createTokenPanel } from "./tokens"
import { BLANK_HTML } from "../workspace/templates"
import { WorkspaceState } from "../workspace/protocol"

declare global {
  interface Window { webkit?: { messageHandlers?: { blackboard?: { postMessage: (value: unknown) => void } } }; blackboardHasUnsavedChanges?: () => boolean }
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
  update: '<path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4"/>',
}
const icon = (value: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${value}</svg>`
for (const [id, value] of Object.entries({ "updates-button": icons.update, "zoom-fit": icons.fit, "preview-board": icons.preview, "duplicate-board": icons.duplicate, "export-board": icons.export, "delete-board": icons.trash })) element(id).innerHTML = icon(value)
for (const [name, value] of Object.entries({ select: icons.select, hand: icons.hand, frame: icons.frame })) {
  const button = document.querySelector<HTMLButtonElement>(`[data-tool="${name}"]`)
  if (button) button.innerHTML = icon(value)
}
if (window.webkit?.messageHandlers?.blackboard) document.documentElement.classList.add("native")

const viewport = element("viewport")
const world = element("world")
const source = element<HTMLTextAreaElement>("html-source")
let state: WorkspaceState | undefined
let camera: Camera = { x: 80, y: 110, zoom: .8 }
let selectedId: string | null = null
let tool: "select" | "hand" | "frame" = "select"
let space = false
let connected = true
let pendingWrites = 0
let saveError = false
let editor: { id: string; revision: number; dirty: boolean } | null = null
window.blackboardHasUnsavedChanges = () => Boolean(editor?.dirty || tokenPanel.hasUnsavedChanges() || pendingWrites)
let toastTimer: ReturnType<typeof setTimeout>
let liveTimer: ReturnType<typeof setTimeout>
const views = new Map<string, { node: HTMLElement; iframe: HTMLIFrameElement; html: string; tokensRevision: number }>()
type HistoryEntry = { before: Board | null; after: Board | null; id: string; revision: number }
const undoStack: HistoryEntry[] = []
const redoStack: HistoryEntry[] = []
const selected = () => state?.workspace.boards.find(b => b.id === selectedId)
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c))
function toast(message: string) {
  clearTimeout(toastTimer); element("toast").textContent = message; element("toast").hidden = false
  toastTimer = setTimeout(() => { element("toast").hidden = true }, 4000)
}
function renderSaveState() {
  element("save-state").textContent = !connected ? "Reconnecting…" : saveError ? "Not saved" : pendingWrites ? "Saving…" : "Saved locally"
  element("save-state").classList.toggle("unsaved", saveError)
}
async function api(path: string, body?: unknown): Promise<unknown> {
  const savesWorkspace = body !== undefined && !path.startsWith("updates/")
  if (savesWorkspace) { pendingWrites++; renderSaveState() }
  try {
    const response = await fetch(`/api/${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const json: unknown = await response.json()
    if (!response.ok) throw new Error(typeof json === "object" && json && "error" in json && typeof json.error === "string" ? json.error : "The change could not be saved.")
    saveError = false
    return json
  } catch (error) { if (savesWorkspace) saveError = true; throw error }
  finally { if (savesWorkspace) pendingWrites--; renderSaveState() }
}
const perform = (action: () => Promise<unknown>) => { void action().catch(error => toast(error instanceof Error ? error.message : "The action failed.")) }
async function refresh() { acceptState(Schema.decodeUnknownSync(WorkspaceState)(await api("state"))) }
function acceptState(next: WorkspaceState) {
  state = next
  if (document.activeElement !== element("workspace-name")) element<HTMLInputElement>("workspace-name").value = next.workspace.name
  renderBoards(); renderUpdate(); renderPreview()
  if (editor && !editor.dirty) {
    const current = next.workspace.boards.find(b => b.id === editor?.id)
    if (current && current.revision !== editor.revision) loadEditor(current)
  }
  if (selectedId && !next.workspace.boards.some(b => b.id === selectedId)) {
    selectedId = null
    if (editor?.dirty) { element("editor-error").hidden = false; element("editor-error").textContent = "This canvas was removed elsewhere. Copy your draft before closing." }
    else closeEditor()
  }
  renderSelection(); renderSaveState(); tokenPanel.update()
}
function renderCamera() {
  world.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`
  viewport.style.backgroundSize = `${20 * camera.zoom}px ${20 * camera.zoom}px`
  viewport.style.backgroundPosition = `${camera.x}px ${camera.y}px`
  element("zoom-value").textContent = `${Math.round(camera.zoom * 100)}%`
  try { localStorage.setItem("blackboard-camera", JSON.stringify(camera)) } catch {}
}
function fit(boards = state?.workspace.boards ?? []) {
  camera = fitBoards(boards, viewport.clientWidth, viewport.clientHeight); renderCamera()
}
function setZoom(zoom: number, point = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }) {
  camera = zoomAt(camera, zoom, point); renderCamera()
}
function setTool(next: typeof tool) {
  tool = next; viewport.classList.toggle("hand", tool === "hand" || space); viewport.classList.toggle("drawing", tool === "frame")
  document.querySelectorAll<HTMLElement>("[data-tool]").forEach(button => {
    button.classList.toggle("active", button.dataset.tool === next); button.setAttribute("aria-pressed", String(button.dataset.tool === next))
  })
}
function renderBoards() {
  if (!state) return
  const ids = new Set(state.workspace.boards.map(b => b.id))
  for (const [id, view] of views) if (!ids.has(id)) { view.node.remove(); views.delete(id) }
  for (const [index, board] of state.workspace.boards.entries()) {
    let view = views.get(board.id)
    if (!view) {
      const node = document.createElement("section")
      node.className = "board"; node.dataset.id = board.id; node.setAttribute("aria-label", board.name)
      node.innerHTML = '<div class="board-label"><span class="board-number"></span><span class="board-title"></span><span class="board-size"></span></div><div class="board-surface"></div><button class="resize-handle" aria-label="Resize canvas"></button>'
      const iframe = document.createElement("iframe")
      iframe.setAttribute("sandbox", ""); iframe.setAttribute("referrerpolicy", "no-referrer"); iframe.setAttribute("tabindex", "-1")
      node.querySelector(".board-surface")?.append(iframe); world.append(node)
      view = { node, iframe, html: "", tokensRevision: -1 }; views.set(board.id, view)
    }
    view.node.classList.toggle("selected", board.id === selectedId)
    view.node.style.cssText = `left:${board.x}px;top:${board.y}px;width:${board.width}px;height:${board.height}px`
    view.node.setAttribute("aria-label", board.name)
    const number = view.node.querySelector(".board-number"); if (number) number.textContent = String(index + 1).padStart(2, "0")
    const title = view.node.querySelector(".board-title"); if (title) title.textContent = board.name
    const size = view.node.querySelector(".board-size"); if (size) size.textContent = `${Math.round(board.width)} × ${Math.round(board.height)}`
    view.iframe.title = board.name
    const content = editor?.id === board.id && editor.dirty ? source.value : board.html
    if (view.html !== content || view.tokensRevision !== state.workspace.tokensRevision) {
      view.iframe.srcdoc = previewDocument(content, state.workspace.tokens); view.html = content; view.tokensRevision = state.workspace.tokensRevision
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
  selectedId = id; renderSelection(); return true
}
function loadEditor(board: Board) {
  editor = { id: board.id, revision: board.revision, dirty: false }
  element("editor-title").textContent = board.name
  element<HTMLInputElement>("board-name").value = board.name
  element<HTMLInputElement>("board-width").value = String(board.width)
  element<HTMLInputElement>("board-height").value = String(board.height)
  source.value = board.html; element("draft-state").textContent = "Saved"; element("editor-error").hidden = true
}
function openEditor() {
  const board = selected(); if (!board) return
  if (editor?.id !== board.id) loadEditor(board)
  element("editor").hidden = false; document.body.classList.add("editing")
  fit([board])
}
function closeEditor(force = false) {
  if (!force && editor?.dirty && !window.confirm("Discard your unsaved HTML draft?")) return false
  clearTimeout(liveTimer)
  const id = editor?.id
  editor = null; element("editor").hidden = true; document.body.classList.remove("editing")
  if (id) { const view = views.get(id); if (view) view.html = "" }
  renderBoards(); return true
}
function markDirty() {
  if (!editor) return
  editor.dirty = true; element("draft-state").textContent = "Unsaved draft"
  clearTimeout(liveTimer)
  liveTimer = setTimeout(() => {
    const view = editor && views.get(editor.id)
    if (view) { view.iframe.srcdoc = previewDocument(source.value, state?.workspace.tokens); view.html = source.value }
  }, 180)
}
function remember(before: Board | null, after: Board | null) {
  const board = after ?? before; if (!board) return
  undoStack.push({ before, after, id: board.id, revision: board.revision }); if (undoStack.length > 60) undoStack.shift(); redoStack.length = 0
}
async function updateBoard(board: Board, patch: BoardPatch) {
  const after = Schema.decodeUnknownSync(Board)(await api(`boards/${encodeURIComponent(board.id)}`, { ...patch, expectedRevision: board.revision }))
  remember(board, after); await refresh(); return after
}
async function saveSource() {
  if (!editor || !state) return
  const before = state.workspace.boards.find(b => b.id === editor?.id)
  if (!before) throw new Error("This canvas no longer exists. Copy your draft before closing.")
  const button = element<HTMLButtonElement>("save-source"); button.disabled = true
  try {
    const after = Schema.decodeUnknownSync(Board)(await api(`boards/${encodeURIComponent(editor.id)}`, {
      html: source.value, name: element<HTMLInputElement>("board-name").value.trim(),
      width: Number(element<HTMLInputElement>("board-width").value), height: Number(element<HTMLInputElement>("board-height").value), expectedRevision: editor.revision,
    }))
    remember(before, after); loadEditor(after); await refresh(); toast("Canvas saved")
  } catch (error) { element("editor-error").hidden = false; element("editor-error").textContent = error instanceof Error ? error.message : "Could not save this draft." }
  finally { button.disabled = false }
}
async function createBoard(input?: { x: number; y: number; width: number; height: number }) {
  if (!select(null)) return
  const bounds = input ?? { x: (viewport.clientWidth / 2 - camera.x) / camera.zoom - 380, y: (viewport.clientHeight / 2 - camera.y) / camera.zoom - 280, width: 760, height: 560 }
  const board = Schema.decodeUnknownSync(Board)(await api("boards", { name: `Untitled canvas ${(state?.workspace.boards.length ?? 0) + 1}`, html: BLANK_HTML, ...bounds }))
  remember(null, board); await refresh(); select(board.id); setTool("select"); openEditor(); fit([board])
}
async function duplicateBoard() {
  const before = selected(); if (!before || !select(null)) return
  const { id, revision, ...fields } = before
  const board = Schema.decodeUnknownSync(Board)(await api("boards", { ...fields, name: `${fields.name.slice(0, 112)} copy`, x: fields.x + fields.width + 64 }))
  remember(null, board); await refresh(); select(board.id); fit()
}
async function deleteBoard() {
  const before = selected(); if (!before || !select(null)) return
  await api(`boards/${encodeURIComponent(before.id)}/delete`, { expectedRevision: before.revision }); remember(before, null); await refresh(); toast("Canvas deleted · ⌘ Z to undo")
}
async function historyStep(redo = false) {
  if (editor?.dirty) return
  const from = redo ? redoStack : undoStack, to = redo ? undoStack : redoStack
  const entry = from.at(-1); if (!entry) return
  const desired = redo ? entry.after : entry.before
  const existing = state?.workspace.boards.find(b => b.id === entry.id)
  const expected = redo ? entry.before : entry.after
  if (existing && expected) {
    const { id: existingId, revision: existingRevision, ...currentFields } = existing
    const { id: expectedId, revision: expectedRevision, ...expectedFields } = expected
    if (JSON.stringify(currentFields) !== JSON.stringify(expectedFields)) throw new Error("This canvas changed elsewhere. Undo is paused to preserve those changes.")
  }
  if (!desired) { await api(`boards/${encodeURIComponent(entry.id)}/delete`, { expectedRevision: existing?.revision }) }
  else {
    const { id, revision, ...fields } = desired
    const after = Schema.decodeUnknownSync(Board)(await api(existing ? `boards/${encodeURIComponent(entry.id)}` : "boards", existing ? { ...fields, expectedRevision: existing.revision } : { ...fields, id: entry.id }))
    entry.id = after.id; entry.revision = after.revision
  }
  from.pop(); to.push(entry); await refresh(); if (desired) select(entry.id)
}
async function copy(value: string) {
  try { await navigator.clipboard.writeText(value) }
  catch {
    const field = document.createElement("textarea"); field.value = value; document.body.append(field); field.select()
    const success = document.execCommand("copy"); field.remove(); if (!success) throw new Error("Clipboard unavailable. Select and copy the text manually.")
  }
}
function exportBoard() {
  const board = selected(); if (!board) return
  const html = exportDocument(board.html, board.name, state?.workspace.tokens)
  const filename = `${board.name.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "canvas"}.html`
  const bridge = window.webkit?.messageHandlers?.blackboard
  if (bridge) bridge.postMessage({ type: "export", filename, html })
  else {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" })); const link = document.createElement("a")
    link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
let previewId: string | null = null
function renderPreview() {
  const dialog = element<HTMLDialogElement>("preview-dialog")
  if (!dialog.open) return
  const board = state?.workspace.boards.find(board => board.id === previewId)
  if (!board) { dialog.close(); return }
  const iframe = element("preview-holder").querySelector("iframe")
  if (!iframe) return
  element("preview-name").textContent = `${board.name} · ${board.width} × ${board.height}`
  iframe.style.width = `${board.width}px`; iframe.style.height = `${board.height}px`
  const html = previewDocument(editor?.dirty && editor.id === board.id ? source.value : board.html, state?.workspace.tokens)
  if (iframe.srcdoc !== html) iframe.srcdoc = html
}
function showPreview() {
  const board = selected(); if (!board) return
  previewId = board.id
  element("preview-name").textContent = `${board.name} · ${board.width} × ${board.height}`
  const iframe = document.createElement("iframe"); iframe.title = `${board.name} preview`; iframe.setAttribute("sandbox", ""); iframe.setAttribute("referrerpolicy", "no-referrer")
  iframe.style.width = `${board.width}px`; iframe.style.height = `${board.height}px`
  iframe.srcdoc = previewDocument(editor?.dirty && editor.id === board.id ? source.value : board.html, state?.workspace.tokens)
  element("preview-holder").replaceChildren(iframe); element<HTMLDialogElement>("preview-dialog").showModal()
}
function showAgent() {
  element("agent-command").textContent = state ? [state.agent.command, ...state.agent.args].map(s => /\s/.test(s) ? JSON.stringify(s) : s).join(" ") : ""
  element("agent-target").textContent = selected() ? `Canvas: ${selected()?.name}` : "Create new canvases"
  element<HTMLDialogElement>("agent-dialog").showModal()
}

type Gesture = { kind: "pan"; x: number; y: number; camera: Camera } | { kind: "move" | "resize"; x: number; y: number; board: Board } | { kind: "draw"; x: number; y: number }
let gesture: Gesture | null = null
const localPoint = (event: { clientX: number; clientY: number }) => { const rect = viewport.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top } }
function drawBounds(x: number, y: number, endX: number, endY: number) { return { x: (Math.min(x, endX) - camera.x) / camera.zoom, y: (Math.min(y, endY) - camera.y) / camera.zoom, width: Math.max(120, Math.abs(endX - x) / camera.zoom), height: Math.max(120, Math.abs(endY - y) / camera.zoom) } }
viewport.addEventListener("pointerdown", event => {
  if (event.button !== 0 && event.button !== 1) return
  const point = localPoint(event)
  if (space || tool === "hand" || event.button === 1) { gesture = { kind: "pan", x: event.clientX, y: event.clientY, camera }; viewport.classList.add("panning") }
  else if (tool === "frame") { gesture = { kind: "draw", ...point }; element("draw-ghost").hidden = false }
  else {
    const target = event.target instanceof Element ? event.target : null
    const id = target?.closest<HTMLElement>(".board")?.dataset.id
    const board = state?.workspace.boards.find(b => b.id === id)
    if (!select(board?.id ?? null)) return
    if (board) gesture = { kind: target?.closest(".resize-handle") ? "resize" : "move", x: event.clientX, y: event.clientY, board }
  }
  if (gesture) { viewport.setPointerCapture(event.pointerId); event.preventDefault() }
})
viewport.addEventListener("pointermove", event => {
  if (!gesture) return
  if (gesture.kind === "pan") { camera = { ...gesture.camera, x: gesture.camera.x + event.clientX - gesture.x, y: gesture.camera.y + event.clientY - gesture.y }; renderCamera() }
  else if (gesture.kind === "draw") {
    const point = localPoint(event); const bounds = drawBounds(gesture.x, gesture.y, point.x, point.y)
    element("draw-ghost").style.cssText = `left:${bounds.x * camera.zoom + camera.x}px;top:${bounds.y * camera.zoom + camera.y}px;width:${bounds.width * camera.zoom}px;height:${bounds.height * camera.zoom}px`
  } else {
    const view = views.get(gesture.board.id); if (!view) return
    const dx = (event.clientX - gesture.x) / camera.zoom, dy = (event.clientY - gesture.y) / camera.zoom
    if (gesture.kind === "move") { view.node.style.left = `${gesture.board.x + dx}px`; view.node.style.top = `${gesture.board.y + dy}px` }
    else { view.node.style.width = `${Math.max(120, Math.min(6000, gesture.board.width + dx))}px`; view.node.style.height = `${Math.max(120, Math.min(6000, gesture.board.height + dy))}px` }
  }
})
function endGesture(event: PointerEvent, cancelled = false) {
  const current = gesture; gesture = null; viewport.classList.remove("panning"); element("draw-ghost").hidden = true
  if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
  if (!current || current.kind === "pan") return
  if (cancelled) { renderBoards(); return }
  const dx = (event.clientX - current.x) / camera.zoom, dy = (event.clientY - current.y) / camera.zoom
  if (current.kind === "draw") { const point = localPoint(event); perform(() => createBoard(drawBounds(current.x, current.y, point.x, point.y))); return }
  if (Math.abs(dx) + Math.abs(dy) < 2) return
  const board = current.board
  const patch = current.kind === "move" ? { x: Math.round(board.x + dx), y: Math.round(board.y + dy) } : { width: Math.round(Math.max(120, Math.min(6000, board.width + dx))), height: Math.round(Math.max(120, Math.min(6000, board.height + dy))) }
  perform(async () => { try { await updateBoard(board, patch) } finally { renderBoards() } })
}
viewport.addEventListener("pointerup", event => endGesture(event))
viewport.addEventListener("pointercancel", event => endGesture(event, true))
viewport.addEventListener("dblclick", () => { if (selected()) openEditor() })
viewport.addEventListener("wheel", event => {
  event.preventDefault()
  if (event.ctrlKey || event.metaKey) setZoom(camera.zoom * Math.exp(-event.deltaY * .01), localPoint(event))
  else { camera = { ...camera, x: camera.x - event.deltaX, y: camera.y - event.deltaY }; renderCamera() }
}, { passive: false })
document.addEventListener("keydown", event => {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.isContentEditable)
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && editor) { event.preventDefault(); perform(saveSource); return }
  if (typing || document.querySelector("dialog[open]")) return
  const command = event.metaKey || event.ctrlKey
  if (event.code === "Space") { event.preventDefault(); space = true; viewport.classList.add("hand") }
  else if (command && event.key.toLowerCase() === "d") { event.preventDefault(); perform(duplicateBoard) }
  else if (command && event.key.toLowerCase() === "z") { event.preventDefault(); perform(() => historyStep(event.shiftKey)) }
  else if (event.key === "Backspace" || event.key === "Delete") { event.preventDefault(); perform(deleteBoard) }
  else if (event.key === "Escape") { if (closeEditor()) select(null); setTool("select") }
  else if (event.shiftKey && event.code === "Digit1") fit()
  else if (command && ["+", "=", "-", "0"].includes(event.key)) { event.preventDefault(); setZoom(event.key === "0" ? 1 : camera.zoom * (event.key === "-" ? .8 : 1.25)) }
  else if (!command && event.key.toLowerCase() === "v") setTool("select")
  else if (!command && event.key.toLowerCase() === "h") setTool("hand")
  else if (!command && event.key.toLowerCase() === "a") setTool("frame")
})
document.addEventListener("keyup", event => { if (event.code === "Space") { space = false; viewport.classList.toggle("hand", tool === "hand") } })
window.addEventListener("blur", () => { space = false; viewport.classList.toggle("hand", tool === "hand") })
window.addEventListener("beforeunload", event => { if (editor?.dirty || pendingWrites) { event.preventDefault(); event.returnValue = "" } })
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) button.addEventListener("click", () => { const value = button.dataset.tool; if (value === "select" || value === "hand" || value === "frame") setTool(value) })
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-close]")) button.addEventListener("click", () => element<HTMLDialogElement>(button.dataset.close ?? "").close())
const tokenPanel = createTokenPanel({ workspace: () => state?.workspace, request: api, refresh, copy, notify: toast })
const actions: Record<string, () => void> = {
  "add-board": () => perform(() => createBoard()), "empty-add": () => perform(() => createBoard()),
  "zoom-in": () => setZoom(camera.zoom * 1.25), "zoom-out": () => setZoom(camera.zoom * .8), "zoom-value": () => setZoom(1), "zoom-fit": () => fit(),
  "edit-board": openEditor, "close-editor": () => { closeEditor() }, "save-source": () => perform(saveSource), "duplicate-board": () => perform(duplicateBoard), "delete-board": () => perform(deleteBoard),
  "preview-board": showPreview, "export-board": exportBoard, "agent-button": showAgent,
  "copy-config": () => perform(async () => { if (!state) return; await copy(JSON.stringify({ mcpServers: { blackboard: state.agent } }, null, 2)); toast("MCP configuration copied") }),
  "copy-brief": () => perform(async () => {
    const brief = element<HTMLTextAreaElement>("agent-brief").value.trim(); if (!brief) { element("agent-brief").focus(); return }
    const board = selected()
    await copy(`Use the Blackboard MCP tools to ${board ? `update canvas "${board.name}" (id: ${board.id})` : "create new canvases"}.\n\n${brief}\n\nCall canvas_list_boards and canvas_list_tokens first. Reuse design tokens as var(--token-name); create missing reusable colors, spacing, typography and radii with canvas_upsert_tokens before generating HTML. Preserve unrelated tokens. ${board ? "Read the current HTML with canvas_get_board. Preserve any unrelated design work." : "Place the canvases alongside the existing boards."} Use complete HTML and inline CSS. Render images as embedded data URLs or CSS shapes. Scripts and external resources are disabled in canvas previews. Use expectedRevision for token and canvas edits. Return the design directly to Blackboard, rather than only describing it.`)
    toast("Prompt copied. Paste it into your connected agent.")
  }),
  "updates-button": () => { element<HTMLDialogElement>("update-dialog").showModal(); if (state && ["idle", "up-to-date", "error"].includes(state.update.status)) perform(() => updateAction("check")) },
}
for (const [id, action] of Object.entries(actions)) element(id).addEventListener("click", action)
for (const id of ["board-name", "board-width", "board-height", "html-source"]) element(id).addEventListener("input", markDirty)
source.addEventListener("keydown", event => { if (event.key === "Tab") { event.preventDefault(); source.setRangeText("  ", source.selectionStart, source.selectionEnd, "end"); markDirty() } })
element("workspace-name").addEventListener("change", () => perform(async () => { await api("workspace", { name: element<HTMLInputElement>("workspace-name").value.trim() }); await refresh() }))

let updateBusy = false
async function updateAction(action: "check" | "install" | "restart" | "download" | "replay") {
  if (updateBusy) return
  if (action === "restart" && (editor?.dirty || pendingWrites)) { toast("Save your canvas draft before restarting."); return }
  updateBusy = true; renderUpdate()
  try { await api(`updates/${action}`, {}); if (action === "replay") await api("updates/check", {}) } finally { updateBusy = false; await refresh() }
}
function renderUpdate() {
  if (!state) return
  const info = state.update
  const preview = state.updatePreview
  element("updates-button").classList.toggle("available", info.hasUpdate)
  element("updates-button").innerHTML = icon(icons.update) + (info.hasUpdate ? `<span>${info.status === "ready-to-restart" ? "Restart to update" : "Update available"}</span>` : "")
  element("updates-button").setAttribute("aria-label", info.hasUpdate ? `${info.status === "ready-to-restart" ? "Restart to update" : "Update available"} · Blackboard ${info.latestVersion}` : "App updates")
  element("updates-button").title = info.hasUpdate ? `Blackboard ${info.latestVersion} is available` : "App updates"
  element("update-title").textContent = info.status === "ready-to-restart" ? "Ready when you are." : info.hasUpdate ? `Blackboard ${info.latestVersion}` : "App updates"
  const working = ["checking", "downloading", "installing"].includes(info.status) || (info.status === "restarting" && !preview)
  const message = info.status === "available" ? "A new version is ready. Download the signed update, then restart whenever you're ready." : info.status === "downloading" || info.status === "installing" ? "Downloading, verifying, and installing the signed update. You can keep working." : info.status === "ready-to-restart" ? "The signed update is installed. Restart Blackboard to finish. Your canvases are saved locally." : info.status === "manual-download" ? preview ? "DMG download simulated. The real action opens the release download in your browser, with instructions to install it in Applications." : "The download has opened in your browser. Open the DMG, drag Blackboard to Applications, then reopen it." : info.status === "up-to-date" ? "You're on the latest version." : info.status === "checking" ? "Checking for a signed update…" : info.status === "restarting" ? preview ? `Restart simulated. Blackboard would reopen at version ${info.latestVersion}, with your canvases where you left them.` : "Restarting Blackboard…" : info.status === "error" ? info.errorMessage ?? "Could not complete the update." : "Check for the latest signed release of Blackboard."
  let buttons = ""
  if (!working) {
    if (info.status === "restarting" && preview) buttons = '<button data-update="replay" class="primary">Replay preview</button><button data-later class="quiet">Back to canvas</button>'
    else if (info.status === "ready-to-restart") buttons = '<button data-update="restart" class="primary">Restart now</button><button data-later class="quiet">Restart later</button>'
    else if (info.hasUpdate && info.canInstallAutomatically && info.status !== "manual-download") buttons = `<button data-update="install" class="primary">${info.status === "error" ? "Try again" : "Download and install"}</button><button data-update="download" class="quiet">Download DMG</button>`
    else buttons = `<button data-update="${info.hasUpdate || info.status === "manual-download" ? "download" : "check"}" class="primary">${info.hasUpdate || info.status === "manual-download" ? "Download DMG" : "Check for updates"}</button>`
  }
  if (info.status === "restarting" && preview) element("update-title").textContent = "You're all set."
  const stage = info.status === "restarting" ? 3 : info.status === "ready-to-restart" ? 2 : ["downloading", "installing"].includes(info.status) ? 1 : 0
  const steps = info.hasUpdate ? `<div class="update-steps">${["Available", "Download & verify", "Restart"].map((label, index) => `<div class="${index < stage ? "done" : index === stage ? "current" : ""}" ${index === stage ? 'aria-current="step"' : ""}><span class="step-dot" aria-hidden="true">${index < stage ? "✓" : index + 1}</span><span>${label}</span></div>`).join("")}</div>` : ""
  element("update-body").innerHTML = `${preview ? '<div class="preview-notice">INTERACTIVE PREVIEW <span>No files are downloaded or installed.</span></div>' : ""}${steps}<div class="update-status" role="status">${escape(message)}</div>${working ? '<div class="update-progress" role="progressbar" aria-label="Update in progress"></div>' : ""}${info.installHint && !info.canInstallAutomatically ? `<p style="font-size:10px;margin:6px 0">${escape(info.installHint)}</p>` : ""}${info.errorMessage && info.status !== "error" ? `<p role="alert">${escape(info.errorMessage)}</p>` : ""}<div class="update-actions">${buttons}</div><div class="update-version">Current version ${escape(info.currentVersion)}</div>`
  element("update-body").querySelectorAll<HTMLButtonElement>("button").forEach(button => {
    button.disabled = updateBusy
    button.addEventListener("click", () => {
      const action = button.dataset.update
      if (action === "check" || action === "install" || action === "restart" || action === "download" || action === "replay") perform(() => updateAction(action))
      else element<HTMLDialogElement>("update-dialog").close()
    })
  })
}

async function start() {
  await refresh()
  try {
    const saved = localStorage.getItem("blackboard-camera")
    if (saved) { const value: unknown = JSON.parse(saved); const parsed = Schema.decodeUnknownSync(Schema.Struct({ x: Schema.Finite, y: Schema.Finite, zoom: Schema.Finite }))(value); camera = { ...parsed, zoom: clampZoom(parsed.zoom) }; renderCamera() }
    else fit()
  } catch { fit() }
  const events = new EventSource("/api/events")
  events.onopen = () => { connected = true; renderSaveState(); perform(refresh) }
  events.onmessage = event => { try { acceptState(Schema.decodeUnknownSync(WorkspaceState)(JSON.parse(event.data))) } catch { toast("Could not read a workspace update. Reload Blackboard.") } }
  events.onerror = () => { connected = false; renderSaveState() }
  if (state?.update.canInstallAutomatically) perform(() => updateAction("check"))
  setInterval(() => { if (state?.update.canInstallAutomatically) perform(() => updateAction("check")) }, 6 * 60 * 60 * 1000)
}
void start().catch(error => { element("fatal").textContent = error instanceof Error ? error.message : "Could not open the workspace."; element("fatal").hidden = false })
