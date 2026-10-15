import { Effect, Layer, Schema } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { APP_VERSION } from "../domain/models"
import { CANVAS_MCP_RESOURCE_URI, CANVAS_MCP_SERVER_NAME } from "../domain/canvas"
import { CanvasService } from "../services/CanvasService"
import {
  CanvasToolkit,
  CanvasCreateElement,
  CanvasUpdateElement,
  CanvasRemoveElement,
  CanvasListElements,
  CanvasClear,
  CanvasSetPage,
} from "./canvasToolkit"

/**
 * MCP tool handlers — pure Effect, backed by CanvasService.
 * Schemas for params/success come from `canvasToolkit.ts` (Effect Schema).
 */
const CanvasHandlersLive = CanvasToolkit.toLayer(
  Effect.gen(function* () {
    const canvas = yield* CanvasService
    return CanvasToolkit.of({
      [CanvasCreateElement.name]: ({ tag, text, subtitle, glyph, style, href, id }) =>
        canvas.createElement({ tag, text, subtitle, glyph, style, href, id }),
      [CanvasUpdateElement.name]: ({ id, patch }) => canvas.updateElement(id, patch),
      [CanvasRemoveElement.name]: ({ id }) =>
        canvas.removeElement(id).pipe(Effect.as({ removedId: id })),
      [CanvasListElements.name]: () =>
        canvas.listElements.pipe(Effect.map((elements) => ({ elements: [...elements] }))),
      [CanvasClear.name]: () => canvas.clearElements.pipe(Effect.as({ cleared: true as const })),
      [CanvasSetPage.name]: ({ elements }) =>
        canvas.replaceAll(elements).pipe(Effect.map((next) => ({ elements: [...next] }))),
    })
  }),
)

/** Live view of the canvas as an MCP resource. */
const CanvasResourceLive = McpServer.resource({
  uri: CANVAS_MCP_RESOURCE_URI,
  name: "Blackboard canvas elements",
  description: "Current HTML-ish element list rendered by the browser canvas.",
  mimeType: "application/json",
  content: Effect.gen(function* () {
    const canvas = yield* CanvasService
    const elements = yield* canvas.listElements
    return JSON.stringify({ elements }, null, 2)
  }),
})

/** Guided prompt for page generation. */
const CanvasPromptLive = McpServer.prompt({
  name: "design-canvas-page",
  description: "Generate a small canvas page (hero + body + badge) via canvas_set_page.",
  parameters: {
    topic: Schema.String,
  },
  content: ({ topic }) =>
    Effect.succeed(
      `Build a Blackboard canvas page about "${topic}" with canvas_set_page: one h1 hero with a glyph, one p intro line, and one badge footer. Keep text short, use style sparingly (background, color, fontSize, borderRadius).`,
    ),
})

const CanvasCapabilitiesLive = Layer.mergeAll(
  McpServer.toolkit(CanvasToolkit),
  CanvasResourceLive,
  CanvasPromptLive,
)

const CanvasMcpBase = CanvasCapabilitiesLive.pipe(
  Layer.provideMerge(CanvasHandlersLive),
  Layer.provideMerge(CanvasService.layer),
)

/**
 * Stdio transport using the latest MCP spec first, with compat fallbacks.
 * Order: 2026-07-28 (latest, stateless) → 2025-11-25 → 2025-06-18.
 */
export const CanvasMcpStdioLive = Layer.mergeAll(CanvasMcpBase).pipe(
  Layer.provide(
    McpServer.layerStdio({
      name: CANVAS_MCP_SERVER_NAME,
      version: APP_VERSION,
      instructions:
        "Blackboard browser-canvas MCP server. Use canvas_* tools to create HTML-ish elements (tag + text + css style) rendered by the desktop browser canvas.",
      protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_11_25, McpProtocol.v2025_06_18],
    }),
  ),
)

export const CanvasMcpProtocols = ["2026-07-28", "2025-11-25", "2025-06-18"] as const
