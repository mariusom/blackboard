import { previewDocument } from '../workspace/model';
import { createDOMPreview } from './preview';
import { app, currentTokens, selected, source } from './appState';
import { element } from './dom';

/** The board HTML to preview: the editor's live draft wins over the saved copy. */
const previewHtml = (boardId: string, savedHtml: string) =>
  previewDocument(app.editor?.dirty && app.editor.id === boardId ? source.value : savedHtml, currentTokens());

export function renderPreview() {
  const dialog = element<HTMLDialogElement>('preview-dialog');
  if (!dialog.open) return;
  const board = app.state?.workspace.boards.find((candidate) => candidate.id === app.previewId);
  if (!board) {
    dialog.close();
    return;
  }
  if (!app.fullPreview || !app.fullPreviewSurface) return;
  element('preview-name').textContent = `${board.name} · ${board.width} × ${board.height}`;
  app.fullPreviewSurface.style.width = `${board.width}px`;
  app.fullPreviewSurface.style.height = `${board.height}px`;
  app.fullPreview.render(previewHtml(board.id, board.html), `${board.name} preview`);
}

export function showPreview() {
  const board = selected();
  if (!board) return;
  app.previewId = board.id;
  element('preview-name').textContent = `${board.name} · ${board.width} × ${board.height}`;
  app.fullPreview?.dispose();
  app.fullPreviewSurface = document.createElement('div');
  app.fullPreviewSurface.className = 'preview-surface';
  app.fullPreviewSurface.style.width = `${board.width}px`;
  app.fullPreviewSurface.style.height = `${board.height}px`;
  app.fullPreview = createDOMPreview(app.fullPreviewSurface);
  app.fullPreview.render(previewHtml(board.id, board.html), `${board.name} preview`);
  element('preview-holder').replaceChildren(app.fullPreviewSurface);
  element<HTMLDialogElement>('preview-dialog').showModal();
}

export function wirePreviewDialog() {
  element<HTMLDialogElement>('preview-dialog').addEventListener('close', () => {
    app.fullPreview?.dispose();
    app.fullPreview = undefined;
    app.fullPreviewSurface = undefined;
    app.previewId = null;
    element('preview-holder').replaceChildren();
  });
}
