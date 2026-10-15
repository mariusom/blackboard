import { Schema } from "effect"

declare const CanvasErrorBrand: unique symbol
export class CanvasError extends Schema.TaggedError<CanvasError, { readonly brand: typeof CanvasErrorBrand }>()(
  "CanvasError",
  {
    message: Schema.String,
    elementId: Schema.optional(Schema.String),
  },
) {}

/** HTML-ish tags the browser canvas can render via GPUIX divs/text. */
export const CanvasElementTag = Schema.Literals([
  "h1",
  "h2",
  "h3",
  "p",
  "text",
  "button",
  "badge",
  "card",
  "image",
  "divider",
  "code",
])
export type CanvasElementTag = typeof CanvasElementTag.Type

/** CSS-subset every element carries. Maps 1:1 to GPUIX StyleDesc. */
export const CanvasStyle = Schema.Struct({
  background: Schema.optional(Schema.String),
  color: Schema.optional(Schema.String),
  fontSize: Schema.optional(Schema.Finite),
  fontWeight: Schema.optional(Schema.Literals(["normal", "bold"])),
  padding: Schema.optional(Schema.Finite),
  borderRadius: Schema.optional(Schema.Finite),
  borderColor: Schema.optional(Schema.String),
  borderWidth: Schema.optional(Schema.Finite),
  textAlign: Schema.optional(Schema.Literals(["left", "center", "right"])),
})
export type CanvasStyle = typeof CanvasStyle.Type

export const CanvasElement = Schema.Struct({
  id: Schema.String,
  tag: CanvasElementTag,
  /** Main text / heading / paragraph body. */
  text: Schema.String,
  /** Secondary line (subtitle, caption, button hint). */
  subtitle: Schema.optional(Schema.String),
  /** Emoji / glyph prefix rendered at large size. */
  glyph: Schema.optional(Schema.String),
  style: Schema.optional(CanvasStyle),
  /** Optional link target shown in the canvas footer. */
  href: Schema.optional(Schema.String),
})
export type CanvasElement = typeof CanvasElement.Type

/** Partial update payload — every field except id is optional. */
export const CanvasElementPatch = Schema.Struct({
  tag: Schema.optional(CanvasElementTag),
  text: Schema.optional(Schema.String),
  subtitle: Schema.optional(Schema.String),
  glyph: Schema.optional(Schema.String),
  style: Schema.optional(CanvasStyle),
  href: Schema.optional(Schema.String),
})
export type CanvasElementPatch = typeof CanvasElementPatch.Type

export const CanvasDocument = Schema.Struct({
  elements: Schema.Array(CanvasElement),
})
export type CanvasDocument = typeof CanvasDocument.Type

export const INITIAL_CANVAS_ELEMENTS: readonly CanvasElement[] = [
  {
    id: "hero",
    tag: "h1",
    text: "Hello from the Blackboard canvas",
    subtitle: "This page is rendered by the browser canvas — populate it via MCP tools.",
    glyph: "▦",
    style: { fontSize: 26, textAlign: "left" },
  },
  {
    id: "intro",
    tag: "p",
    text: "Connect the blackboard-canvas MCP server, then call canvas_create_element with tag + text + css. Elements appear here live.",
    style: { fontSize: 13 },
  },
  {
    id: "cta-row",
    tag: "badge",
    text: "MCP ready",
    subtitle: "stdio · spec 2026-07-28",
    glyph: "✦",
    style: { background: "#059669", color: "#ffffff", fontSize: 12, borderRadius: 999 },
  },
]

export const CANVAS_MCP_SERVER_NAME = "blackboard-canvas"
export const CANVAS_MCP_RESOURCE_URI = "canvas://blackboard/elements"
