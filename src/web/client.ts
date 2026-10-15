import { Schema } from 'effect';
import { Board, exportDocument, previewDocument, type BoardPatch } from '../workspace/model';
import { createTokenPanel } from './tokens';
import { BLANK_HTML } from '../workspace/templates';
import { WorkspaceState } from '../workspace/protocol';
import {
  app,
  currentTokens,
  selected,
  source,
  viewport,
  type HistoryEntry,
  type InspectorMode,
  type LibraryTab,
  type Tool,
} from './appState';
import { applyIcons, element, toast } from './dom';
import { fit, setZoom } from './camera';
import { renderBoards, renderInspector, renderLibrary, renderSaveState, renderSelection } from './rendering';
import { createUpdatePanel } from './updatePanel';
import { createInteractions } from './interactions';
import { renderPreview, showPreview } from './canvasPreview';
import { wireActions } from './actionWiring';
import { startApp } from './bootstrap';

declare global {
  interface Window {
    webkit?: { messageHandlers?: { blackboard?: { postMessage: (value: unknown) => void } } };
    blackboardHasUnsavedChanges?: () => boolean;
  }
}

applyIcons();

async function api(path: string, body?: unknown): Promise<unknown> {
  const savesWorkspace = body !== undefined && !path.startsWith('updates/');
  if (savesWorkspace) {
    app.pendingWrites++;
    renderSaveState();
  }
  try {
    const response = await fetch(
      `/api/${path}`,
      body === undefined
        ? {}
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    const json: unknown = await response.json();
    if (!response.ok)
      throw new Error(
        typeof json === 'object' && json && 'error' in json && typeof json.error === 'string'
          ? json.error
          : 'The change could not be saved.',
      );
    app.saveError = false;
    return json;
  } catch (error) {
    if (savesWorkspace) app.saveError = true;
    throw error;
  } finally {
    if (savesWorkspace) app.pendingWrites--;
    renderSaveState();
  }
}

function perform(action: () => Promise<unknown>) {
  void action().catch((error) => toast(error instanceof Error ? error.message : 'The action failed.'));
}

async function refresh() {
  acceptState(Schema.decodeUnknownSync(WorkspaceState)(await api('state')));
}

function select(id: string | null): boolean {
  if (id !== app.selectedId && app.editor?.dirty && !window.confirm('Discard your unsaved HTML draft?')) return false;
  if (id !== app.selectedId && app.editor) closeEditor(true);
  app.selectedId = id;
  app.inspectorMode = id ? 'canvas' : app.state?.workspace.boards.length ? 'canvas' : 'agent';
  renderSelection();
  renderLibrary(renderDeps);
  renderInspector(renderDeps);
  return true;
}

function loadEditor(board: Board) {
  app.editor = { id: board.id, revision: board.revision, dirty: false };
  element('editor-title').textContent = board.name;
  element<HTMLInputElement>('board-name').value = board.name;
  element<HTMLInputElement>('board-width').value = String(board.width);
  element<HTMLInputElement>('board-height').value = String(board.height);
  source.value = board.html;
  element('draft-state').textContent = 'Saved';
  element('editor-error').hidden = true;
}

function openEditor() {
  const board = selected();
  if (!board) return;
  if (app.editor?.id !== board.id) loadEditor(board);
  element('editor').hidden = false;
  document.body.classList.add('editing');
  renderInspector(renderDeps);
  fit([board]);
}

function closeEditor(force = false) {
  if (!force && app.editor?.dirty && !window.confirm('Discard your unsaved HTML draft?')) return false;
  clearTimeout(app.liveTimer);
  const id = app.editor?.id;
  app.editor = null;
  element('editor').hidden = true;
  document.body.classList.remove('editing');
  if (id) {
    const view = app.views.get(id);
    if (view) view.html = '';
  }
  renderBoards();
  renderInspector(renderDeps);
  return true;
}

function markDirty() {
  const editor = app.editor;
  if (!editor) return;
  editor.dirty = true;
  element('draft-state').textContent = 'Unsaved draft';
  clearTimeout(app.liveTimer);
  app.liveTimer = setTimeout(() => {
    const view = app.editor && app.views.get(app.editor.id);
    if (!view) return;
    view.preview.render(
      previewDocument(source.value, currentTokens()),
      app.editor?.id === app.selectedId ? (selected()?.name ?? 'Canvas') : 'Canvas',
    );
    view.html = source.value;
  }, 180);
}

function remember(before: Board | null, after: Board | null) {
  const board = after ?? before;
  if (!board) return;
  app.undoStack.push({ before, after, id: board.id, revision: board.revision });
  if (app.undoStack.length > 60) app.undoStack.shift();
  app.redoStack.length = 0;
}

async function updateBoard(board: Board, patch: BoardPatch) {
  const after = Schema.decodeUnknownSync(Board)(
    await api(`boards/${encodeURIComponent(board.id)}`, { ...patch, expectedRevision: board.revision }),
  );
  remember(board, after);
  const editor = app.editor;
  if (
    editor?.id === board.id &&
    editor.dirty &&
    patch.html === undefined &&
    patch.name === undefined &&
    patch.width === undefined &&
    patch.height === undefined
  )
    editor.revision = after.revision;
  await refresh();
  return after;
}

async function saveSource() {
  const editor = app.editor;
  if (!editor || !app.state) return;
  const before = app.state.workspace.boards.find((board) => board.id === editor.id);
  if (!before) throw new Error('This canvas no longer exists. Copy your draft before closing.');
  const button = element<HTMLButtonElement>('save-source');
  button.disabled = true;
  try {
    const after = Schema.decodeUnknownSync(Board)(
      await api(`boards/${encodeURIComponent(editor.id)}`, {
        html: source.value,
        name: element<HTMLInputElement>('board-name').value.trim(),
        width: Number(element<HTMLInputElement>('board-width').value),
        height: Number(element<HTMLInputElement>('board-height').value),
        expectedRevision: editor.revision,
      }),
    );
    remember(before, after);
    loadEditor(after);
    await refresh();
    toast('Canvas saved');
  } catch (error) {
    element('editor-error').hidden = false;
    element('editor-error').textContent = error instanceof Error ? error.message : 'Could not save this draft.';
  } finally {
    button.disabled = false;
  }
}

async function createBoard(input?: { x: number; y: number; width: number; height: number }) {
  if (!select(null)) return;
  const bounds = input ?? {
    x: (viewport.clientWidth / 2 - app.camera.x) / app.camera.zoom - 380,
    y: (viewport.clientHeight / 2 - app.camera.y) / app.camera.zoom - 280,
    width: 760,
    height: 560,
  };
  const board = Schema.decodeUnknownSync(Board)(
    await api('boards', {
      name: `Untitled canvas ${(app.state?.workspace.boards.length ?? 0) + 1}`,
      html: BLANK_HTML,
      ...bounds,
    }),
  );
  remember(null, board);
  await refresh();
  select(board.id);
  setTool('select');
  fit([board]);
}

async function duplicateBoard() {
  const before = selected();
  if (!before || !select(null)) return;
  const { id, revision, ...fields } = before;
  const board = Schema.decodeUnknownSync(Board)(
    await api('boards', { ...fields, name: `${fields.name.slice(0, 112)} copy`, x: fields.x + fields.width + 64 }),
  );
  remember(null, board);
  await refresh();
  select(board.id);
  fit();
}

async function deleteBoard() {
  const before = selected();
  if (!before || !select(null)) return;
  await api(`boards/${encodeURIComponent(before.id)}/delete`, { expectedRevision: before.revision });
  remember(before, null);
  await refresh();
  toast('Canvas deleted · ⌘ Z to undo');
}

function assertHistorySafe(entry: HistoryEntry, redo: boolean) {
  const existing = app.state?.workspace.boards.find((board) => board.id === entry.id);
  const expected = redo ? entry.before : entry.after;
  if (!existing || !expected) return;
  const { id: existingId, revision: existingRevision, ...currentFields } = existing;
  const { id: expectedId, revision: expectedRevision, ...expectedFields } = expected;
  if (JSON.stringify(currentFields) !== JSON.stringify(expectedFields))
    throw new Error('This canvas changed elsewhere. Undo is paused to preserve those changes.');
}

async function applyHistory(entry: HistoryEntry, desired: Board | null) {
  const existing = app.state?.workspace.boards.find((board) => board.id === entry.id);
  if (!desired) {
    if (existing) await api(`boards/${encodeURIComponent(entry.id)}/delete`, { expectedRevision: existing.revision });
    return;
  }
  const { id, revision, ...fields } = desired;
  const after = Schema.decodeUnknownSync(Board)(
    await api(
      existing ? `boards/${encodeURIComponent(entry.id)}` : 'boards',
      existing ? { ...fields, expectedRevision: existing.revision } : { ...fields, id: entry.id },
    ),
  );
  entry.id = after.id;
  entry.revision = after.revision;
}

async function historyStep(redo = false) {
  if (app.editor?.dirty) return;
  const from = redo ? app.redoStack : app.undoStack;
  const to = redo ? app.undoStack : app.redoStack;
  const entry = from.at(-1);
  if (!entry) return;
  assertHistorySafe(entry, redo);
  const desired = redo ? entry.after : entry.before;
  await applyHistory(entry, desired);
  from.pop();
  to.push(entry);
  await refresh();
  if (desired) select(entry.id);
}

async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const field = document.createElement('textarea');
    field.value = value;
    document.body.append(field);
    field.select();
    const success = document.execCommand('copy');
    field.remove();
    if (!success) throw new Error('Clipboard unavailable. Select and copy the text manually.');
  }
}

function exportBoard() {
  if (window.blackboardHasUnsavedChanges?.()) {
    toast('Save your drafts before exporting.');
    return;
  }
  const board = selected();
  if (!board) return;
  const html = exportDocument(board.html, board.name, app.state?.workspace.tokens);
  const filename = `${board.name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'canvas'}.html`;
  const bridge = window.webkit?.messageHandlers?.blackboard;
  // WKWebView's script-message bridge takes a single value, not a target origin.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  if (bridge) bridge.postMessage({ type: 'export', filename, html });
  else {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function activateLibrary(tab: LibraryTab) {
  app.libraryTab = tab;
  document.body.classList.remove('library-collapsed');
  element('library').hidden = false;
  element('library-toggle').setAttribute('aria-expanded', 'true');
  element('canvases-panel').hidden = tab !== 'canvases';
  element('tokens-sidebar').hidden = tab !== 'tokens';
  element('canvases-button').setAttribute('aria-selected', String(tab === 'canvases'));
  element('tokens-button').setAttribute('aria-selected', String(tab === 'tokens'));
  element('canvases-button').tabIndex = tab === 'canvases' ? 0 : -1;
  element('tokens-button').tabIndex = tab === 'tokens' ? 0 : -1;
  if (tab === 'tokens') tokenPanel.update();
}

function activateInspector(mode: InspectorMode) {
  if (app.editor && !closeEditor()) return false;
  app.inspectorMode = mode;
  renderInspector(renderDeps);
  return true;
}

async function changeProperty(patch: BoardPatch) {
  const board = selected();
  if (!board || app.propertySaving) return;
  app.propertySaving = true;
  renderInspector(renderDeps);
  element('property-error').hidden = true;
  try {
    await updateBoard(board, patch);
  } catch (cause) {
    element('property-error').textContent = cause instanceof Error ? cause.message : 'Could not save this canvas.';
    element('property-error').hidden = false;
  } finally {
    app.propertySaving = false;
    renderInspector(renderDeps);
  }
}

function showAgent() {
  if (activateInspector('agent')) element('agent-brief').focus();
}

function startDesign(format: 'website' | 'mobile') {
  if (!select(null)) return;
  element<HTMLSelectElement>('agent-format').value = format === 'website' ? 'responsive' : 'mobile';
  const brief = element<HTMLTextAreaElement>('agent-brief');
  if (!brief.value.trim())
    brief.value =
      format === 'website'
        ? 'Design a thoughtful website with a matching mobile version. Reuse my shared design tokens.'
        : 'Design a focused mobile app screen. Reuse my shared design tokens.';
  showAgent();
}

function setTool(next: Tool) {
  app.tool = next;
  viewport.classList.toggle('hand', app.tool === 'hand' || app.space);
  viewport.classList.toggle('drawing', app.tool === 'frame');
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tool === next);
    button.setAttribute('aria-pressed', String(button.dataset.tool === next));
  });
}

function announceAgentChanges(before: WorkspaceState, next: WorkspaceState) {
  if (!app.awaitingAgent || JSON.stringify(next.workspace.boards) === JSON.stringify(before.workspace.boards)) return;
  app.awaitingAgent = false;
  element('agent-handoff-state').textContent = 'Canvas updated. Select it in the library to review.';
  element('agent-handoff-state').classList.add('copied');
  const added = next.workspace.boards.filter(
    (board) => !before.workspace.boards.some((previous) => previous.id === board.id),
  );
  if (added.length) fit(added);
  toast('New design changes arrived in your workspace');
}

function syncEditor(next: WorkspaceState) {
  const editor = app.editor;
  if (!editor || editor.dirty) return;
  const current = next.workspace.boards.find((board) => board.id === editor.id);
  if (current && current.revision !== editor.revision) loadEditor(current);
}

function dropMissingSelection(next: WorkspaceState) {
  if (!app.selectedId || next.workspace.boards.some((board) => board.id === app.selectedId)) return;
  app.selectedId = null;
  if (app.editor?.dirty) {
    element('editor-error').hidden = false;
    element('editor-error').textContent = 'This canvas was removed elsewhere. Copy your draft before closing.';
  } else closeEditor();
}

function acceptState(next: WorkspaceState) {
  const before = app.state;
  app.state = next;
  if (before) announceAgentChanges(before, next);
  if (document.activeElement !== element('workspace-name'))
    element<HTMLInputElement>('workspace-name').value = next.workspace.name;
  renderBoards();
  updatePanel.renderUpdate();
  renderPreview();
  syncEditor(next);
  dropMissingSelection(next);
  renderSelection();
  renderLibrary(renderDeps);
  renderInspector(renderDeps);
  renderSaveState();
  tokenPanel.update();
}

const tokenPanel = createTokenPanel({
  workspace: () => app.state?.workspace,
  request: api,
  refresh,
  copy,
  notify: toast,
  onInspect: () => activateInspector('token'),
  onClose: () => {
    activateInspector(selected() ? 'canvas' : 'agent');
  },
  onLibrary: () => activateLibrary('tokens'),
  onSelectBoard: (id) => {
    if (select(id)) {
      const board = selected();
      if (board) fit([board]);
    }
  },
  onPreview: (tokens) => {
    if (app.previewTokens === tokens) return;
    app.previewTokens = tokens;
    app.previewRevision++;
    element('token-preview-banner').hidden = !tokens;
    renderBoards();
    renderPreview();
  },
});

window.blackboardHasUnsavedChanges = () =>
  Boolean(app.editor?.dirty || tokenPanel.hasUnsavedChanges() || app.pendingWrites);

const renderDeps = { select, fit, selectToken: (name: string) => tokenPanel.selectToken(name) };
const updatePanel = createUpdatePanel({ request: api, refresh, perform, notify: toast });
const checkUpdates = () => perform(() => updatePanel.updateAction('check'));

createInteractions({
  select,
  fit,
  setZoom,
  setTool,
  openEditor,
  closeEditor,
  createBoard,
  updateBoard,
  duplicateBoard,
  deleteBoard,
  historyStep,
  saveSource,
  renderBoards,
  perform,
});

wireActions({
  perform,
  createBoard,
  showPreview,
  exportBoard,
  openEditor,
  showAgent,
  activateInspector,
  activateLibrary,
  historyStep,
  revealTokenDraft: () => tokenPanel.revealDraft(),
  setZoom,
  fit,
  closeEditor,
  saveSource,
  duplicateBoard,
  deleteBoard,
  checkUpdates,
  copy,
  changeProperty,
  markDirty,
  startDesign,
  request: api,
  refresh,
  renderLibrary: () => renderLibrary(renderDeps),
});

void startApp({
  refresh,
  select,
  activateInspector,
  checkUpdates,
  acceptState,
  renderSaveState,
  perform,
}).catch((error) => {
  element('fatal').textContent = error instanceof Error ? error.message : 'Could not open the workspace.';
  element('fatal').hidden = false;
});
