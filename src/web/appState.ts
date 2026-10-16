import type { ElementSelection } from './elementProtocol';
import type { Board, Camera } from '../workspace/model';
import type { WorkspaceState } from '../workspace/protocol';
import type { DesignToken } from '../workspace/tokens';
import type { createDOMPreview } from './preview';
import type { createTokenPanel } from './tokens';
import { element } from './dom';

export type Tool = 'select' | 'hand' | 'frame';
export type InspectorMode = 'canvas' | 'token' | 'agent' | null;
export type LibraryTab = 'canvases' | 'tokens';

export interface EditorState {
  id: string;
  revision: number;
  dirty: boolean;
}
export interface HistoryEntry {
  before: Board | null;
  after: Board | null;
  id: string;
  revision: number;
}
export interface BoardView {
  node: HTMLElement;
  preview: ReturnType<typeof createDOMPreview>;
  html: string;
  editing: boolean;
  tokensRevision: string;
}
export type Gesture =
  | { kind: 'pan'; x: number; y: number; camera: Camera }
  | { kind: 'move' | 'resize'; x: number; y: number; board: Board }
  | { kind: 'draw'; x: number; y: number };

export type TokenPanel = ReturnType<typeof createTokenPanel>;

export const viewport = element('viewport');
export const world = element('world');
export const source = element<HTMLTextAreaElement>('html-source');

/** The workspace UI keeps its mutable state here so the rendering, preview,
 * interaction and update modules can share it without importing each other. */
export interface VisualEditorState {
  board: Board;
  html: string;
  channel: string;
  frame: Window | null;
  selection: ElementSelection | undefined;
  dirty: boolean;
  saving: boolean;
}
export const app = {
  visualEditor: null as VisualEditorState | null,
  state: undefined as WorkspaceState | undefined,
  camera: { x: 80, y: 110, zoom: 0.8 } as Camera,
  selectedId: null as string | null,
  inspectorMode: 'canvas' as InspectorMode,
  libraryTab: 'canvases' as LibraryTab,
  previewTokens: undefined as readonly DesignToken[] | undefined,
  previewRevision: 0,
  propertySaving: false,
  awaitingAgent: false,
  layoutReady: false,
  tool: 'select' as Tool,
  space: false,
  connected: true,
  pendingWrites: 0,
  saveError: false,
  editor: null as EditorState | null,
  views: new Map<string, BoardView>(),
  canvasRows: new Map<string, HTMLButtonElement>(),
  undoStack: [] as HistoryEntry[],
  redoStack: [] as HistoryEntry[],
  gesture: null as Gesture | null,
  previewId: null as string | null,
  fullPreview: undefined as ReturnType<typeof createDOMPreview> | undefined,
  fullPreviewSurface: undefined as HTMLElement | undefined,
  liveTimer: undefined as ReturnType<typeof setTimeout> | undefined,
};

export const currentTokens = () => app.previewTokens ?? app.state?.workspace.tokens;
export const tokensKey = () => `${app.state?.workspace.tokensRevision}:${app.previewRevision}`;
export const selected = () => app.state?.workspace.boards.find((board) => board.id === app.selectedId);
