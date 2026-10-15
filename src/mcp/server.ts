import { Effect, Layer, Schema } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { APP_VERSION } from "../domain/models"
import { CanvasConnection } from "../workspace/connection"
import { CanvasToolkit, CanvasListBoards, CanvasGetBoard, CanvasCreateBoard, CanvasUpdateBoard, CanvasDeleteBoard, CanvasListTokens, CanvasUpsertTokens, CanvasDeleteToken } from "./canvasToolkit"

const CanvasHandlersLive = CanvasToolkit.toLayer(Effect.gen(function* () {
  const connection = yield* CanvasConnection
  return CanvasToolkit.of({
    [CanvasListBoards.name]: () => connection.list,
    [CanvasGetBoard.name]: ({ id }) => connection.board(id),
    [CanvasCreateBoard.name]: input => connection.create(input),
    [CanvasUpdateBoard.name]: ({ id, patch }) => connection.update(id, patch),
    [CanvasDeleteBoard.name]: ({ id, expectedRevision }) => connection.remove(id, expectedRevision).pipe(Effect.as({ removedId: id })),
    [CanvasListTokens.name]: () => connection.tokens,
    [CanvasUpsertTokens.name]: input => connection.upsertTokens(input),
    [CanvasDeleteToken.name]: ({ name, expectedRevision }) => connection.deleteToken(name, expectedRevision),
  })
}))
const WorkspaceResource = McpServer.resource({
  uri: "canvas://blackboard/workspace", name: "Blackboard workspace", mimeType: "application/json",
  description: "The saved workspace currently open in Blackboard. All tools edit this same live workspace.",
  content: Effect.gen(function* () { return JSON.stringify(yield* (yield* CanvasConnection).list, null, 2) }),
})
const CanvasPrompt = McpServer.prompt({
  name: "design-canvas-page", description: "Design HTML/CSS canvases in the open Blackboard workspace.", parameters: { topic: Schema.String },
  content: ({ topic }) => Effect.succeed(`Design ${topic} in Blackboard. First call canvas_list_boards and canvas_list_tokens. Reuse existing design tokens as var(--token-name), and create missing reusable colors, spacing, typography and radii with canvas_upsert_tokens before generating HTML. Preserve unrelated tokens and canvases. Create or update named canvases with complete HTML/CSS. Use expectedRevision for token and HTML updates. Give desktop and mobile variants their own canvases. Use inline CSS and embedded images/SVG; previews disable scripts and external resources. The output should appear in Blackboard.`),
})
const TokenResource = McpServer.resource({
  uri: "canvas://blackboard/tokens", name: "Blackboard design tokens", mimeType: "application/json",
  description: "Shared design values used as CSS custom properties by the workspace's canvases.",
  content: Effect.gen(function* () { return JSON.stringify(yield* (yield* CanvasConnection).tokens, null, 2) }),
})
const Capabilities = Layer.mergeAll(McpServer.toolkit(CanvasToolkit), WorkspaceResource, TokenResource, CanvasPrompt).pipe(
  Layer.provide(CanvasHandlersLive), Layer.provide(CanvasConnection.layer),
)
export const CanvasMcpStdioLive = Capabilities.pipe(Layer.provide(McpServer.layerStdio({
  name: "blackboard-canvas", version: APP_VERSION,
  instructions: "Create and edit HTML/CSS canvases in the open Blackboard app. Inspect existing canvases and design tokens first. Reuse tokens with var(--token-name); create missing reusable design values with canvas_upsert_tokens before generating HTML. Token edits affect every linked canvas. Preserve unrelated tokens and canvases; use expectedRevision for updates. Use inline assets, HTML and CSS; scripts and external requests are disabled in previews.",
  protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
})))
