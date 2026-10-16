import { Schema } from 'effect';
import type { Board, BoardPatch } from '../workspace/model';
import { app } from './appState';
import { element, toast } from './dom';
import { ElementMessage, elementStyleValue, elementLabel } from './elementProtocol';
import { buildElementControls, renderElementControls } from './elementControls';

export interface ElementEditorDeps {
  readonly render: () => void;
  readonly updateBoard: (board: Board, patch: BoardPatch) => Promise<Board>;
}

function send(command: object) {
  const editor = app.visualEditor;
  editor?.frame?.postMessage({ ...command, channel: editor.channel }, '*');
}

export function renderElementInspector() {
  const editor = app.visualEditor;
  element('element-inspector').hidden = !editor;
  if (!editor) return;
  const selection = editor.selection;
  element('element-canvas-name').textContent = editor.board.name;
  element('element-selected').textContent = selection
    ? elementLabel(selection.tag, selection.label)
    : 'Pick an element';
  element('element-pick-hint').hidden = Boolean(selection);
  element('element-properties').hidden = !selection;
  element('element-text-field').hidden = !selection?.editableText;
  const text = element<HTMLTextAreaElement>('element-text');
  if (selection && document.activeElement !== text) text.value = selection.text;
  text.disabled = editor.saving;
  element('element-draft-state').textContent = editor.saving
    ? 'Saving…'
    : editor.dirty
      ? 'Unsaved design changes'
      : 'All changes saved';
  element<HTMLButtonElement>('element-save').disabled = !editor.dirty || editor.saving;
  element<HTMLButtonElement>('element-discard').disabled = !editor.dirty || editor.saving;
  renderElementControls();
}

export function createElementEditor(deps: ElementEditorDeps) {
  buildElementControls((property, raw) => {
    const value = elementStyleValue(property, raw);
    if (!CSS.supports(property, value)) {
      toast('Enter a valid value or choose a shared token.');
      return;
    }
    send({ type: 'style', property, value });
  });
  const close = (force = false) => {
    if (app.visualEditor?.saving) return false;
    if (!force && app.visualEditor?.dirty && !window.confirm('Discard your unsaved design changes?')) return false;
    app.visualEditor = null;
    deps.render();
    return true;
  };
  const open = (board: Board) => {
    if (app.visualEditor?.board.id === board.id) return;
    if (!close()) return;
    app.visualEditor = {
      board,
      html: board.html,
      channel: crypto.randomUUID(),
      frame: null,
      selection: undefined,
      dirty: false,
      saving: false,
    };
    app.inspectorMode = 'canvas';
    deps.render();
    toast('Click an element to edit its text, spacing, colors, and shared tokens.');
  };
  window.addEventListener('message', (event) => receiveMessage(event));
  wireElementActions({ deps, close });
  return { open, close };
}

function receiveMessage(event: MessageEvent) {
  const editor = app.visualEditor;
  if (!editor || event.source !== editor.frame || event.origin !== 'null') return;
  try {
    const message = Schema.decodeUnknownSync(ElementMessage)(event.data);
    if (message.channel !== editor.channel) return;
    const changedSelection = editor.selection?.key !== message.selection.key;
    editor.selection = message.selection;
    if (changedSelection) element('element-inspector-scroll').scrollTop = 0;
    if (message.type === 'change' && message.html !== undefined) {
      editor.html = message.html;
      editor.dirty = editor.html !== editor.board.html;
      const view = app.views.get(editor.board.id);
      if (view) view.html = message.html;
    }
    renderElementInspector();
  } catch {
    /* Reject malformed or stale frame messages. */
  }
}

async function saveDesign(deps: ElementEditorDeps) {
  const editor = app.visualEditor;
  if (!editor || !editor.dirty || editor.saving) return;
  editor.saving = true;
  const html = editor.html;
  element('element-error').hidden = true;
  renderElementInspector();
  try {
    const after = await deps.updateBoard(editor.board, { html });
    editor.board = after;
    editor.dirty = editor.html !== html;
    toast('Design saved');
  } catch (cause) {
    element('element-error').textContent = cause instanceof Error ? cause.message : 'Could not save your design.';
    element('element-error').hidden = false;
  } finally {
    editor.saving = false;
    renderElementInspector();
  }
}

function wireElementActions(options: { deps: ElementEditorDeps; close: (force?: boolean) => boolean }) {
  const { deps, close } = options;
  element('element-done').addEventListener('click', () => close());
  element('element-parent').addEventListener('click', () => send({ type: 'parent' }));
  element('element-save').addEventListener('click', () => void saveDesign(deps));
  element('element-discard').addEventListener('click', () => {
    const board = app.visualEditor?.board;
    if (board && close(true)) {
      // Reopen from the last saved snapshot, preserving the canvas view.
      element('edit-design').click();
    }
  });
  element('element-text').addEventListener('input', () =>
    send({ type: 'text', value: element<HTMLTextAreaElement>('element-text').value }),
  );
  element('element-inspector').addEventListener('keydown', (event) => {
    event.stopPropagation();
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void saveDesign(deps);
    }
  });
}
