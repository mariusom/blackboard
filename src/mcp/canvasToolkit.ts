import { Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { Board, BoardPatch, BoardSummary, CreateBoard, Workspace, WorkspaceError } from "../workspace/model"
import { DeleteToken, TokenCollection, UpsertTokens } from "../workspace/tokens"

export const CanvasListBoards = Tool.make("canvas_list_boards", {
  description: "Read the live Blackboard workspace, including canvas IDs, positions, sizes, revisions and HTML. Open Blackboard first. Canvas previews render HTML and CSS; scripts, external resources and network requests are disabled. Embed images as data URLs or use CSS/SVG artwork.",
  success: Workspace, failure: WorkspaceError,
})
export const CanvasGetBoard = Tool.make("canvas_get_board", {
  description: "Read a canvas and its current HTML/revision before editing it.",
  parameters: Schema.Struct({ id: Schema.String }), success: Board, failure: WorkspaceError,
})
export const CanvasCreateBoard = Tool.make("canvas_create_board", {
  description: "Create an HTML canvas in the open Blackboard workspace. Use full HTML/CSS in html. Dimensions are CSS pixels; x/y are canvas coordinates. Omit x to place beside existing canvases. The canvas appears live and saves locally.",
  parameters: CreateBoard, success: Board, failure: WorkspaceError,
})
export const CanvasUpdateBoard = Tool.make("canvas_update_board", {
  description: "Update a canvas. Supply only the fields you intend to change. Read its revision, then provide expectedRevision when replacing HTML to protect concurrent edits. Preserve unrelated canvases.",
  parameters: Schema.Struct({ id: Schema.String, patch: BoardPatch }), success: Board, failure: WorkspaceError,
})
export const CanvasDeleteBoard = Tool.make("canvas_delete_board", {
  description: "Delete one canvas by ID when the user requests its removal. Read its revision first and pass expectedRevision; a canvas that changed since you read it is not deleted by mistake.",
  parameters: Schema.Struct({ id: Schema.String, expectedRevision: Schema.Int }), success: Schema.Struct({ removedId: Schema.String }), failure: WorkspaceError,
})
export const CanvasSearch = Tool.make("canvas_search", {
  description: "Find canvases by name or HTML content. Returns matching canvases with their ids, positions, sizes and revisions, but not their full HTML. Read a match with canvas_get_board before editing it.",
  parameters: Schema.Struct({ query: Schema.String.check(Schema.isMaxLength(200)) }), success: Schema.Array(BoardSummary), failure: WorkspaceError,
})
export const CanvasListTokens = Tool.make("canvas_list_tokens", {
  description: "Read the shared design-token library and its revision. Reuse these values in every canvas as CSS var(--token-name). Tokens include colors, spacing, typography and radii; linked canvases and HTML exports update together.",
  success: TokenCollection, failure: WorkspaceError,
})
export const CanvasUpsertTokens = Tool.make("canvas_upsert_tokens", {
  description: "Create or update shared design tokens by name, preserving all unrelated tokens. Names are lowercase kebab-case (color-brand, space-md). An optional category groups tokens in the sidebar independently of their value type. Colors use hex; dimensions use px/rem/em/percent; aliases use var(--existing-token). Read the library first and send expectedRevision to protect concurrent edits. Create reusable tokens before generating the HTML that references them.",
  parameters: UpsertTokens, success: TokenCollection, failure: WorkspaceError,
})
export const CanvasDeleteToken = Tool.make("canvas_delete_token", {
  description: "Remove an unused design token. References in canvases or aliases must be replaced first; in-use tokens cannot be deleted.",
  parameters: DeleteToken, success: TokenCollection, failure: WorkspaceError,
})
export const CanvasToolkit = Toolkit.make(CanvasListBoards, CanvasGetBoard, CanvasSearch, CanvasCreateBoard, CanvasUpdateBoard, CanvasDeleteBoard, CanvasListTokens, CanvasUpsertTokens, CanvasDeleteToken)
