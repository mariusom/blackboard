import { Schema } from 'effect';
import type { Board, BoardPatch } from '../workspace/model';
import { AgentFormat, buildAgentPrompt } from './agentPrompt';
import { app, selected, source, type InspectorMode, type LibraryTab } from './appState';
import { wirePreviewDialog } from './canvasPreview';
import { element, toast } from './dom';

export interface ActionDeps {
  readonly perform: (action: () => Promise<unknown>) => void;
  readonly createBoard: (input?: { x: number; y: number; width: number; height: number }) => Promise<void>;
  readonly showPreview: () => void;
  readonly exportBoard: () => void;
  readonly openEditor: () => void;
  readonly showAgent: () => void;
  readonly activateInspector: (mode: InspectorMode) => boolean;
  readonly activateLibrary: (tab: LibraryTab) => void;
  readonly historyStep: (redo?: boolean) => Promise<void>;
  readonly revealTokenDraft: () => void;
  readonly setZoom: (zoom: number, point?: { x: number; y: number }) => void;
  readonly fit: (boards?: readonly Board[]) => void;
  readonly closeEditor: () => boolean;
  readonly saveSource: () => Promise<void>;
  readonly duplicateBoard: () => Promise<void>;
  readonly deleteBoard: () => Promise<void>;
  readonly checkUpdates: () => void;
  readonly copy: (value: string) => Promise<void>;
  readonly changeProperty: (patch: BoardPatch) => Promise<void>;
  readonly markDirty: () => void;
  readonly startDesign: (format: 'website' | 'mobile') => void;
  readonly request: (path: string, body?: unknown) => Promise<unknown>;
  readonly refresh: () => Promise<void>;
  readonly renderLibrary: () => void;
}

function buildActions(deps: ActionDeps): Record<string, () => void> {
  return {
    'add-board': () => deps.perform(() => deps.createBoard()),
    'empty-add': () => deps.perform(() => deps.createBoard()),
    'library-new': () => deps.perform(() => deps.createBoard()),
    'tool-new': () => deps.perform(() => deps.createBoard()),
    'header-preview': deps.showPreview,
    'header-export': deps.exportBoard,
    'inspector-edit': deps.openEditor,
    'inspector-agent': deps.showAgent,
    'tool-agent': deps.showAgent,
    'no-selection-agent': deps.showAgent,
    'close-agent': () => {
      deps.activateInspector('canvas');
    },
    'collapse-inspector': () => {
      deps.activateInspector(null);
    },
    'undo-button': () => deps.perform(() => deps.historyStep()),
    'redo-button': () => deps.perform(() => deps.historyStep(true)),
    'canvases-button': () => deps.activateLibrary('canvases'),
    'review-token-draft': deps.revealTokenDraft,
    'library-toggle': () => {
      const collapsed = document.body.classList.toggle('library-collapsed');
      element('library').hidden = collapsed;
      element('library-toggle').setAttribute('aria-expanded', String(!collapsed));
    },
    'zoom-in': () => deps.setZoom(app.camera.zoom * 1.25),
    'zoom-out': () => deps.setZoom(app.camera.zoom * 0.8),
    'zoom-value': () => deps.setZoom(1),
    'zoom-fit': () => deps.fit(),
    'edit-board': deps.openEditor,
    'close-editor': () => {
      deps.closeEditor();
    },
    'save-source': () => deps.perform(deps.saveSource),
    'duplicate-board': () => deps.perform(deps.duplicateBoard),
    'delete-board': () => deps.perform(deps.deleteBoard),
    'preview-board': deps.showPreview,
    'export-board': deps.exportBoard,
    'agent-button': deps.showAgent,
    'copy-config': () =>
      deps.perform(async () => {
        if (!app.state) return;
        await deps.copy(JSON.stringify({ mcpServers: { blackboard: app.state.agent } }, null, 2));
        toast('MCP configuration copied');
      }),
    'copy-brief': () =>
      deps.perform(async () => {
        if (window.blackboardHasUnsavedChanges?.()) {
          toast('Save or discard your drafts before handing this canvas to your agent.');
          return;
        }
        const brief = element<HTMLTextAreaElement>('agent-brief').value.trim();
        if (!brief) {
          element('agent-brief').focus();
          return;
        }
        const format = Schema.decodeUnknownSync(AgentFormat)(element<HTMLSelectElement>('agent-format').value);
        await deps.copy(buildAgentPrompt(brief, format, selected()));
        app.awaitingAgent = true;
        element('agent-handoff-state').textContent =
          'Prompt copied. Paste it into your agent; results will appear here.';
        element('agent-handoff-state').classList.add('copied');
        toast('Prompt copied. Ready for your connected agent.');
      }),
    'updates-button': () => {
      element<HTMLDialogElement>('update-dialog').showModal();
      if (app.state && ['idle', 'up-to-date', 'error'].includes(app.state.update.status)) deps.checkUpdates();
    },
  };
}

/** Attach the action bar and the remaining form/editor listeners. */
export function wireActions(deps: ActionDeps) {
  for (const [id, action] of Object.entries(buildActions(deps))) element(id).addEventListener('click', action);
  wirePreviewDialog();
  element('canvas-search').addEventListener('input', deps.renderLibrary);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-starter]'))
    button.addEventListener('click', () =>
      deps.startDesign(button.dataset.starter === 'mobile' ? 'mobile' : 'website'),
    );
  for (const [id, key] of Object.entries({
    'property-name': 'name',
    'property-x': 'x',
    'property-y': 'y',
    'property-width': 'width',
    'property-height': 'height',
  })) {
    element<HTMLInputElement>(id).addEventListener('change', (event) => {
      const input = event.currentTarget;
      if (!(input instanceof HTMLInputElement) || !input.reportValidity()) return;
      deps.perform(() => deps.changeProperty({ [key]: key === 'name' ? input.value.trim() : Number(input.value) }));
    });
  }
  element<HTMLSelectElement>('canvas-preset').addEventListener('change', (event) => {
    if (!(event.currentTarget instanceof HTMLSelectElement)) return;
    const preset = event.currentTarget.value;
    if (preset === 'desktop') deps.perform(() => deps.changeProperty({ width: 1440, height: 900 }));
    if (preset === 'mobile') deps.perform(() => deps.changeProperty({ width: 390, height: 844 }));
    if (preset === 'tablet') deps.perform(() => deps.changeProperty({ width: 768, height: 1024 }));
  });
  for (const id of ['board-name', 'board-width', 'board-height', 'html-source'])
    element(id).addEventListener('input', deps.markDirty);
  source.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      source.setRangeText('  ', source.selectionStart, source.selectionEnd, 'end');
      deps.markDirty();
    }
  });
  element('workspace-name').addEventListener('change', () =>
    deps.perform(async () => {
      await deps.request('workspace', { name: element<HTMLInputElement>('workspace-name').value.trim() });
      await deps.refresh();
    }),
  );
}
