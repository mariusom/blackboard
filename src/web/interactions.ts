import type { Board, BoardPatch } from '../workspace/model';
import { app, selected, viewport, type Gesture, type Tool } from './appState';
import { renderCamera, drawBounds, localPoint } from './camera';
import { element } from './dom';

export interface InteractionDeps {
  readonly select: (id: string | null) => boolean;
  readonly fit: (boards?: readonly Board[]) => void;
  readonly setZoom: (zoom: number, point?: { x: number; y: number }) => void;
  readonly setTool: (tool: Tool) => void;
  readonly openEditor: () => void;
  readonly closeEditor: (force?: boolean) => boolean;
  readonly createBoard: (input?: { x: number; y: number; width: number; height: number }) => Promise<void>;
  readonly updateBoard: (board: Board, patch: BoardPatch) => Promise<Board>;
  readonly duplicateBoard: () => Promise<void>;
  readonly deleteBoard: () => Promise<void>;
  readonly historyStep: (redo?: boolean) => Promise<void>;
  readonly saveSource: () => Promise<void>;
  readonly renderBoards: () => void;
  readonly perform: (action: () => Promise<unknown>) => void;
}

const interactiveTarget = (event: PointerEvent) =>
  event.target instanceof Element ? event.target.closest('button,input,select,textarea') : null;

function beginBoardGesture(event: PointerEvent, deps: InteractionDeps): boolean {
  const target = event.target instanceof Element ? event.target : null;
  const id = target?.closest<HTMLElement>('.board')?.dataset.id;
  const board = app.state?.workspace.boards.find((candidate) => candidate.id === id);
  if (!deps.select(board?.id ?? null)) return false;
  if (board)
    app.gesture = {
      kind: target?.closest('.resize-handle') ? 'resize' : 'move',
      x: event.clientX,
      y: event.clientY,
      board,
    };
  return true;
}

function beginGesture(event: PointerEvent, deps: InteractionDeps) {
  if (event.button !== 0 && event.button !== 1) return;
  const interactive = interactiveTarget(event);
  if (interactive && !interactive.classList.contains('resize-handle')) return;
  if (app.space || app.tool === 'hand' || event.button === 1) {
    app.gesture = { kind: 'pan', x: event.clientX, y: event.clientY, camera: app.camera };
    viewport.classList.add('panning');
  } else if (app.tool === 'frame') {
    app.gesture = { kind: 'draw', ...localPoint(event) };
    element('draw-ghost').hidden = false;
  } else if (!beginBoardGesture(event, deps)) return;
  if (app.gesture) {
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
}

function moveOrResize(gesture: Extract<Gesture, { board: Board }>, event: PointerEvent) {
  const view = app.views.get(gesture.board.id);
  if (!view) return;
  const dx = (event.clientX - gesture.x) / app.camera.zoom;
  const dy = (event.clientY - gesture.y) / app.camera.zoom;
  if (gesture.kind === 'move') {
    view.node.style.left = `${gesture.board.x + dx}px`;
    view.node.style.top = `${gesture.board.y + dy}px`;
  } else {
    view.node.style.width = `${Math.max(120, Math.min(6000, gesture.board.width + dx))}px`;
    view.node.style.height = `${Math.max(120, Math.min(6000, gesture.board.height + dy))}px`;
  }
}

function continueGesture(event: PointerEvent) {
  const gesture = app.gesture;
  if (!gesture) return;
  if (gesture.kind === 'pan') {
    app.camera = {
      ...gesture.camera,
      x: gesture.camera.x + event.clientX - gesture.x,
      y: gesture.camera.y + event.clientY - gesture.y,
    };
    renderCamera();
  } else if (gesture.kind === 'draw') {
    const bounds = drawBounds({ x: gesture.x, y: gesture.y }, localPoint(event));
    element('draw-ghost').style.cssText =
      `left:${bounds.x * app.camera.zoom + app.camera.x}px;top:${bounds.y * app.camera.zoom + app.camera.y}px;width:${bounds.width * app.camera.zoom}px;height:${bounds.height * app.camera.zoom}px`;
  } else moveOrResize(gesture, event);
}

function commitGesture(gesture: Extract<Gesture, { board: Board }>, event: PointerEvent, deps: InteractionDeps) {
  const dx = (event.clientX - gesture.x) / app.camera.zoom;
  const dy = (event.clientY - gesture.y) / app.camera.zoom;
  const board = gesture.board;
  const patch =
    gesture.kind === 'move'
      ? { x: Math.round(board.x + dx), y: Math.round(board.y + dy) }
      : {
          width: Math.round(Math.max(120, Math.min(6000, board.width + dx))),
          height: Math.round(Math.max(120, Math.min(6000, board.height + dy))),
        };
  deps.perform(async () => {
    try {
      await deps.updateBoard(board, patch);
    } finally {
      deps.renderBoards();
    }
  });
}

function endGesture(event: PointerEvent, deps: InteractionDeps, cancelled = false) {
  const current = app.gesture;
  app.gesture = null;
  viewport.classList.remove('panning');
  element('draw-ghost').hidden = true;
  if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  if (!current || current.kind === 'pan') return;
  if (cancelled) {
    deps.renderBoards();
    return;
  }
  if (current.kind === 'draw') {
    deps.perform(() => deps.createBoard(drawBounds({ x: current.x, y: current.y }, localPoint(event))));
    return;
  }
  const dx = (event.clientX - current.x) / app.camera.zoom;
  const dy = (event.clientY - current.y) / app.camera.zoom;
  if (Math.abs(dx) + Math.abs(dy) < 2) return;
  commitGesture(current, event, deps);
}

const isTyping = (event: KeyboardEvent) =>
  event.target instanceof HTMLInputElement ||
  event.target instanceof HTMLTextAreaElement ||
  event.target instanceof HTMLSelectElement ||
  (event.target instanceof HTMLElement && event.target.isContentEditable);

const releaseSpace = () => {
  app.space = false;
  viewport.classList.toggle('hand', app.tool === 'hand');
};

function focusLibrarySearch() {
  if (document.body.classList.contains('library-collapsed')) element('library-toggle').click();
  element(app.libraryTab === 'tokens' ? 'token-search' : 'canvas-search').focus();
}

function handleToolShortcut(event: KeyboardEvent, deps: InteractionDeps) {
  const key = event.key.toLowerCase();
  if (key === 'v') deps.setTool('select');
  else if (key === 'h') deps.setTool('hand');
  else if (key === 'a') deps.setTool('frame');
  else return false;
  return true;
}

function pressSpace(event: KeyboardEvent) {
  event.preventDefault();
  app.space = true;
  viewport.classList.add('hand');
  return true;
}

function runShortcut(event: KeyboardEvent, action: () => Promise<unknown>, deps: InteractionDeps) {
  event.preventDefault();
  deps.perform(action);
  return true;
}

function escapeShortcut(deps: InteractionDeps) {
  if (deps.closeEditor()) deps.select(null);
  deps.setTool('select');
  return true;
}

function zoomShortcut(event: KeyboardEvent, deps: InteractionDeps) {
  event.preventDefault();
  deps.setZoom(event.key === '0' ? 1 : app.camera.zoom * (event.key === '-' ? 0.8 : 1.25));
  return true;
}

function handleCommandShortcut(event: KeyboardEvent, command: boolean, deps: InteractionDeps) {
  const key = event.key.toLowerCase();
  if (event.code === 'Space') return pressSpace(event);
  if (command && key === 'd') return runShortcut(event, deps.duplicateBoard, deps);
  if (command && key === 'z') return runShortcut(event, () => deps.historyStep(event.shiftKey), deps);
  if (event.key === 'Backspace' || event.key === 'Delete') return runShortcut(event, deps.deleteBoard, deps);
  if (event.key === 'Escape') return escapeShortcut(deps);
  if (event.shiftKey && event.code === 'Digit1') {
    deps.fit();
    return true;
  }
  if (command && ['+', '=', '-', '0'].includes(event.key)) return zoomShortcut(event, deps);
  return command ? false : handleToolShortcut(event, deps);
}

function handleKeydown(event: KeyboardEvent, deps: InteractionDeps) {
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    focusLibrarySearch();
    return;
  }
  if (command && event.key === 'Enter' && app.editor) {
    event.preventDefault();
    deps.perform(deps.saveSource);
    return;
  }
  if (isTyping(event) || document.querySelector('dialog[open]')) return;
  handleCommandShortcut(event, command, deps);
}

export function createInteractions(deps: InteractionDeps) {
  viewport.addEventListener('pointerdown', (event) => beginGesture(event, deps));
  viewport.addEventListener('pointermove', (event) => continueGesture(event));
  viewport.addEventListener('pointerup', (event) => endGesture(event, deps));
  viewport.addEventListener('pointercancel', (event) => endGesture(event, deps, true));
  viewport.addEventListener('dblclick', () => {
    if (selected()) deps.openEditor();
  });
  viewport.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey)
        deps.setZoom(app.camera.zoom * Math.exp(-event.deltaY * 0.01), localPoint(event));
      else {
        app.camera = { ...app.camera, x: app.camera.x - event.deltaX, y: app.camera.y - event.deltaY };
        renderCamera();
      }
    },
    { passive: false },
  );
  document.addEventListener('keydown', (event) => handleKeydown(event, deps));
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') releaseSpace();
  });
  window.addEventListener('blur', releaseSpace);
  window.addEventListener('beforeunload', (event) => {
    if (window.blackboardHasUnsavedChanges?.()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]'))
    button.addEventListener('click', () => {
      const value = button.dataset.tool;
      if (value === 'select' || value === 'hand' || value === 'frame') deps.setTool(value);
    });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-close]'))
    button.addEventListener('click', () => element<HTMLDialogElement>(button.dataset.close ?? '').close());
}
