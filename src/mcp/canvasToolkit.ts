import { Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { Board, BoardPatch, CreateBoard, Workspace, WorkspaceError } from "../workspace/model"

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
  description: "Delete one canvas by ID when the user requests its removal.",
  parameters: Schema.Struct({ id: Schema.String }), success: Schema.Struct({ removedId: Schema.String }), failure: WorkspaceError,
})
export const CanvasToolkit = Toolkit.make(CanvasListBoards, CanvasGetBoard, CanvasCreateBoard, CanvasUpdateBoard, CanvasDeleteBoard)
