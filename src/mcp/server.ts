import { Effect, Layer, Schema } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { APP_VERSION } from "../domain/models"
import { WorkspaceError } from "../workspace/model"
import { CanvasConnection } from "../workspace/connection"
import { CanvasToolkit, CanvasListBoards, CanvasGetBoard, CanvasCreateBoard, CanvasUpdateBoard, CanvasDeleteBoard } from "./canvasToolkit"

const CanvasHandlersLive = CanvasToolkit.toLayer(Effect.gen(function* () {
  const connection = yield* CanvasConnection
  return CanvasToolkit.of({
    [CanvasListBoards.name]: () => connection.list,
    [CanvasGetBoard.name]: ({ id }) => Effect.gen(function* () {
      const board = (yield* connection.list).boards.find(b => b.id === id)
      if (!board) return yield* new WorkspaceError({ code: "missing", message: `Canvas '${id}' was not found.` })
      return board
    }),
    [CanvasCreateBoard.name]: input => connection.create(input),
    [CanvasUpdateBoard.name]: ({ id, patch }) => connection.update(id, patch),
    [CanvasDeleteBoard.name]: ({ id }) => connection.remove(id).pipe(Effect.as({ removedId: id })),
  })
}))
const WorkspaceResource = McpServer.resource({
  uri: "canvas://blackboard/workspace", name: "Blackboard workspace", mimeType: "application/json",
  description: "The saved workspace currently open in Blackboard. All tools edit this same live workspace.",
  content: Effect.gen(function* () { return JSON.stringify(yield* (yield* CanvasConnection).list, null, 2) }),
})
const CanvasPrompt = McpServer.prompt({
  name: "design-canvas-page", description: "Design HTML/CSS canvases in the open Blackboard workspace.", parameters: { topic: Schema.String },
  content: ({ topic }) => Effect.succeed(`Design ${topic} in Blackboard. First call canvas_list_boards. Create or update named canvases with complete HTML/CSS, using canvas_create_board or canvas_update_board. Preserve unrelated work. Use expectedRevision for HTML updates. Give desktop and mobile variants their own canvases. Use inline CSS and embedded images/SVG; canvas previews disable scripts and external resources. The output should appear in Blackboard.`),
})
const Capabilities = Layer.mergeAll(McpServer.toolkit(CanvasToolkit), WorkspaceResource, CanvasPrompt).pipe(
  Layer.provide(CanvasHandlersLive), Layer.provide(CanvasConnection.layer),
)
export const CanvasMcpStdioLive = Capabilities.pipe(Layer.provide(McpServer.layerStdio({
  name: "blackboard-canvas", version: APP_VERSION,
  instructions: "Create and edit HTML/CSS canvases in the open Blackboard app. Inspect existing canvases first. Tools update the live saved workspace. Use inline assets, HTML and CSS; scripts and external requests are disabled in previews.",
  protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
})))
