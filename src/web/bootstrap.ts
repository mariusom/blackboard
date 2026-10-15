import { Schema } from 'effect';
import { clampZoom } from '../workspace/model';
import { StreamedWorkspaceState, mergeStreamedState, type WorkspaceState } from '../workspace/protocol';
import { app, viewport, type InspectorMode } from './appState';
import { fit, renderCamera } from './camera';
import { toast } from './dom';

export interface BootstrapDeps {
  readonly refresh: () => Promise<void>;
  readonly select: (id: string | null) => boolean;
  readonly activateInspector: (mode: InspectorMode) => boolean;
  readonly checkUpdates: () => void;
  readonly acceptState: (next: WorkspaceState) => void;
  readonly renderSaveState: () => void;
  readonly perform: (action: () => Promise<unknown>) => void;
}

export async function startApp(deps: BootstrapDeps) {
  await deps.refresh();
  if (app.state?.workspace.boards.length) {
    const first = app.state.workspace.boards[0];
    if (first) deps.select(first.id);
  } else deps.activateInspector('agent');
  let width = viewport.clientWidth;
  let height = viewport.clientHeight;
  new ResizeObserver(() => {
    const nextWidth = viewport.clientWidth;
    const nextHeight = viewport.clientHeight;
    if (app.layoutReady) {
      app.camera = {
        ...app.camera,
        x: app.camera.x + (nextWidth - width) / 2,
        y: app.camera.y + (nextHeight - height) / 2,
      };
      renderCamera();
    }
    width = nextWidth;
    height = nextHeight;
  }).observe(viewport);
  try {
    const saved = localStorage.getItem('blackboard-camera');
    if (saved) {
      const value: unknown = JSON.parse(saved);
      const parsed = Schema.decodeUnknownSync(
        Schema.Struct({ x: Schema.Finite, y: Schema.Finite, zoom: Schema.Finite }),
      )(value);
      app.camera = { ...parsed, zoom: clampZoom(parsed.zoom) };
      renderCamera();
    } else fit();
  } catch {
    fit();
  }
  app.layoutReady = true;
  const events = new EventSource('/api/events');
  events.addEventListener('open', () => {
    app.connected = true;
    deps.renderSaveState();
    deps.perform(deps.refresh);
  });
  events.addEventListener('message', (event) => {
    try {
      deps.acceptState(
        mergeStreamedState(app.state, Schema.decodeUnknownSync(StreamedWorkspaceState)(JSON.parse(event.data))),
      );
    } catch {
      toast('Could not read a workspace update. Reload Blackboard.');
    }
  });
  events.addEventListener('error', () => {
    app.connected = false;
    deps.renderSaveState();
  });
  if (app.state?.update.canInstallAutomatically) deps.checkUpdates();
  setInterval(
    () => {
      if (app.state?.update.canInstallAutomatically) deps.checkUpdates();
    },
    6 * 60 * 60 * 1000,
  );
}
