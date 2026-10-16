import type { Board } from '../workspace/model';
import { previewDocument } from '../workspace/model';
import { tokenReferences } from '../workspace/tokens';
import { canvasRow, emptyLibraryMessage, visibleCanvases } from './library';
import { createDOMPreview } from './preview';
import { editableDocument } from './elementDocument';
import { renderElementInspector } from './elementEditing';
import { app, currentTokens, selected, source, tokensKey, world, type BoardView } from './appState';
import { element } from './dom';

export interface RenderDeps {
  readonly select: (id: string | null) => boolean;
  readonly fit: (boards?: readonly Board[]) => void;
  readonly selectToken: (name: string) => void;
}

export function renderSaveState() {
  const saveState = element('save-state');
  saveState.textContent = !app.connected
    ? 'Reconnecting…'
    : app.saveError
      ? 'Not saved'
      : app.pendingWrites
        ? 'Saving…'
        : 'Saved locally';
  saveState.classList.toggle('unsaved', app.saveError);
}

function pruneBoardViews(ids: Set<string>) {
  for (const [id, view] of app.views)
    if (!ids.has(id)) {
      view.preview.dispose();
      view.node.remove();
      app.views.delete(id);
    }
}

function createBoardView(board: Board): BoardView {
  const node = document.createElement('section');
  node.className = 'board';
  node.dataset.id = board.id;
  node.setAttribute('aria-label', board.name);
  node.innerHTML =
    '<div class="board-label"><span class="board-number"></span><span class="board-title"></span><span class="board-size"></span></div><div class="board-surface"></div><button class="resize-handle" aria-label="Resize canvas"></button>';
  const surface = node.querySelector<HTMLElement>('.board-surface');
  if (!surface) throw new Error('Missing canvas preview surface');
  world.append(node);
  const view: BoardView = { node, preview: createDOMPreview(surface), html: '', tokensRevision: '', editing: false };
  app.views.set(board.id, view);
  return view;
}

function decorateBoardView(view: BoardView, board: Board, index: number) {
  view.node.classList.toggle('selected', board.id === app.selectedId);
  view.node.style.cssText = `left:${board.x}px;top:${board.y}px;width:${board.width}px;height:${board.height}px`;
  view.node.setAttribute('aria-label', board.name);
  const number = view.node.querySelector('.board-number');
  if (number) number.textContent = String(index + 1).padStart(2, '0');
  const title = view.node.querySelector('.board-title');
  if (title) title.textContent = board.name;
  const size = view.node.querySelector('.board-size');
  if (size) size.textContent = `${Math.round(board.width)} × ${Math.round(board.height)}`;
}

function renderBoardPreview(view: BoardView, board: Board) {
  const editor = app.visualEditor?.board.id === board.id ? app.visualEditor : null;
  if (view.editing !== Boolean(editor)) {
    view.preview.dispose();
    const surface = view.node.querySelector<HTMLElement>('.board-surface');
    if (!surface) return;
    view.preview = createDOMPreview(surface, {
      interactive: Boolean(editor),
      onFrame: (frame) => {
        if (editor) {
          editor.frame = frame.contentWindow;
          editor.selection = undefined;
        }
      },
    });
    view.editing = Boolean(editor);
    view.html = '';
  }
  const content = editor?.html ?? (app.editor?.id === board.id && app.editor.dirty ? source.value : board.html);
  if (view.html !== content || view.tokensRevision !== tokensKey()) {
    const html = editor
      ? editableDocument(content, currentTokens(), editor.channel)
      : previewDocument(content, currentTokens());
    view.preview.render(html, board.name);
    view.html = content;
    view.tokensRevision = tokensKey();
  }
}

export function renderBoards() {
  const state = app.state;
  if (!state) return;
  pruneBoardViews(new Set(state.workspace.boards.map((board) => board.id)));
  state.workspace.boards.forEach((board, index) => {
    const view = app.views.get(board.id) ?? createBoardView(board);
    decorateBoardView(view, board, index);
    renderBoardPreview(view, board);
  });
  element('empty').hidden = state.workspace.boards.length !== 0;
}

export function renderSelection() {
  const board = selected();
  element('selection-bar').hidden = !board;
  element('stage-heading').hidden = Boolean(board);
  element('selected-name').textContent = board?.name ?? '';
  for (const [id, view] of app.views) view.node.classList.toggle('selected', id === app.selectedId);
}

function renderLibraryCounts() {
  const state = app.state;
  if (!state) return;
  const count = state.workspace.boards.length;
  element('canvas-total').textContent = String(count);
  element('token-total').textContent = String(state.workspace.tokens.length);
  element('app-version').textContent = `v${state.version}`;
  element('stage-label').textContent = count ? 'DESIGN EXPLORATIONS' : 'YOUR WORKSPACE';
  element('stage-count').textContent = `${count} canvas${count === 1 ? '' : 'es'}`;
}

function canvasRowElement(board: Board, deps: RenderDeps): HTMLButtonElement {
  let row = app.canvasRows.get(board.id);
  if (!row) {
    row = document.createElement('button');
    row.className = 'canvas-row';
    row.type = 'button';
    row.innerHTML = '<span class="canvas-icon"></span><span class="canvas-label"></span><small></small>';
    const id = board.id;
    row.addEventListener('click', () => {
      const current = app.state?.workspace.boards.find((candidate) => candidate.id === id);
      if (current && deps.select(current.id)) deps.fit([current]);
    });
    app.canvasRows.set(board.id, row);
  }
  const model = canvasRow(board, app.selectedId);
  row.classList.toggle('active', model.active);
  row.setAttribute('aria-label', `Select ${model.label}`);
  row.setAttribute('aria-pressed', String(model.active));
  const iconNode = row.querySelector('.canvas-icon');
  if (iconNode) iconNode.textContent = model.icon;
  const labelNode = row.querySelector('.canvas-label');
  if (labelNode) labelNode.textContent = model.label;
  const sizeNode = row.querySelector('small');
  if (sizeNode) sizeNode.textContent = model.size;
  return row;
}

function renderLibraryRows(boards: readonly Board[], list: HTMLElement, deps: RenderDeps) {
  for (const board of boards) list.append(canvasRowElement(board, deps));
  const visible = new Set(boards.map((board) => board.id));
  for (const [id, row] of app.canvasRows)
    if (!visible.has(id)) {
      row.remove();
      app.canvasRows.delete(id);
    }
}

function renderLibraryEmptyState(list: HTMLElement, query: string, hasBoards: boolean) {
  const existing = list.querySelector<HTMLElement>('.library-empty');
  if (hasBoards) {
    existing?.remove();
    return;
  }
  const message = emptyLibraryMessage(query);
  if (existing) existing.textContent = message;
  else {
    const empty = document.createElement('p');
    empty.className = 'library-empty';
    empty.textContent = message;
    list.append(empty);
  }
}

export function renderLibrary(deps: RenderDeps) {
  const state = app.state;
  if (!state) return;
  renderLibraryCounts();
  const list = element('canvas-list');
  const query = element<HTMLInputElement>('canvas-search').value;
  const boards = visibleCanvases(state.workspace.boards, query);
  renderLibraryRows(boards, list, deps);
  renderLibraryEmptyState(list, query, boards.length > 0);
  element<HTMLButtonElement>('undo-button').disabled = !app.undoStack.length;
  element<HTMLButtonElement>('redo-button').disabled = !app.redoStack.length;
}

function renderInspectorPanels(board: Board | undefined) {
  const editing = Boolean(app.editor || app.visualEditor);
  document.body.classList.toggle('inspector-hidden', !app.editor && app.inspectorMode === null);
  element('canvas-inspector').hidden = editing || app.inspectorMode !== 'canvas';
  element('token-inspector').hidden = editing || app.inspectorMode !== 'token';
  element('agent-panel').hidden = editing || app.inspectorMode !== 'agent';
  element('no-selection').hidden = Boolean(board);
  element('canvas-properties').hidden = !board;
  for (const id of ['header-preview', 'header-export']) element<HTMLButtonElement>(id).disabled = !board;
  element('agent-button').setAttribute('aria-pressed', String(app.inspectorMode === 'agent' && !app.editor));
}

function renderAgentSummary() {
  const state = app.state;
  element('agent-command').textContent = state
    ? [state.agent.command, ...state.agent.args]
        .map((value) => (/\s/.test(value) ? JSON.stringify(value) : value))
        .join(' ')
    : '';
  element('agent-token-count').textContent = `◈ ${state?.workspace.tokens.length ?? 0} shared tokens`;
}

function canvasPreset(board: Board) {
  if (board.width === 1440 && board.height === 900) return 'desktop';
  if (board.width === 390 && board.height === 844) return 'mobile';
  if (board.width === 768 && board.height === 1024) return 'tablet';
  return 'custom';
}

function renderCanvasProperties(board: Board) {
  element('inspector-name').textContent = board.name;
  const values = {
    'property-name': board.name,
    'property-x': board.x,
    'property-y': board.y,
    'property-width': board.width,
    'property-height': board.height,
  };
  for (const [id, value] of Object.entries(values)) {
    const input = element<HTMLInputElement>(id);
    if (document.activeElement !== input) input.value = String(value);
    input.disabled = app.propertySaving;
  }
  const preset = element<HTMLSelectElement>('canvas-preset');
  preset.disabled = app.propertySaving;
  if (document.activeElement !== preset) preset.value = canvasPreset(board);
  element('source-snippet').textContent =
    board.html.length > 200 ? `${board.html.slice(0, 200)}…` : board.html || 'This canvas is ready for your HTML.';
}

function renderUsedTokens(board: Board, selectToken: (name: string) => void) {
  const references = tokenReferences(board.html);
  element('used-token-count').textContent = String(references.length);
  const used = element('used-tokens');
  used.replaceChildren();
  for (const name of references) {
    const chip = document.createElement('button');
    chip.className = 'token-chip';
    chip.textContent = `◈ ${name}`;
    chip.addEventListener('click', () => selectToken(name));
    used.append(chip);
  }
  if (!references.length) {
    const text = document.createElement('p');
    text.textContent = 'Use var(--token-name) in your CSS to link this canvas to your design system.';
    used.append(text);
  }
}

export function renderInspector(deps: RenderDeps) {
  const board = selected();
  renderInspectorPanels(board);
  renderElementInspector();
  renderAgentSummary();
  element('agent-target').textContent = board ? `Canvas: ${board.name}` : 'New canvases';
  if (!board) return;
  renderCanvasProperties(board);
  renderUsedTokens(board, deps.selectToken);
}
