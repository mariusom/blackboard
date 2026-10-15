import { Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import {
  CanvasElement,
  CanvasElementPatch,
  CanvasElementTag,
  CanvasError,
  CanvasStyle,
} from "../domain/canvas"

const StyleInput = Schema.Struct({
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

export const CanvasCreateElement = Tool.make("canvas_create_element", {
  description:
    "Create (or upsert by id) one HTML-ish element on the Blackboard browser canvas. Use tag + text + optional css style.",
  parameters: Schema.Struct({
    tag: CanvasElementTag,
    text: Schema.String,
    subtitle: Schema.optional(Schema.String),
    glyph: Schema.optional(Schema.String),
    style: Schema.optional(StyleInput),
    href: Schema.optional(Schema.String),
    id: Schema.optional(Schema.String),
  }),
  success: CanvasElement,
})

export const CanvasUpdateElement = Tool.make("canvas_update_element", {
  description: "Patch text, tag, glyph, href or css style of an existing canvas element by id.",
  parameters: Schema.Struct({
    id: Schema.String,
    patch: CanvasElementPatch,
  }),
  success: CanvasElement,
  failure: CanvasError,
})

export const CanvasRemoveElement = Tool.make("canvas_remove_element", {
  description: "Remove a single element from the browser canvas by id.",
  parameters: Schema.Struct({ id: Schema.String }),
  success: Schema.Struct({ removedId: Schema.String }),
  failure: CanvasError,
})

export const CanvasListElements = Tool.make("canvas_list_elements", {
  description: "List every element currently on the browser canvas, in render order.",
  success: Schema.Struct({ elements: Schema.Array(CanvasElement) }),
})

export const CanvasClear = Tool.make("canvas_clear", {
  description: "Remove all elements from the browser canvas (empty page).",
  success: Schema.Struct({ cleared: Schema.Boolean }),
})

export const CanvasSetPage = Tool.make("canvas_set_page", {
  description:
    "Replace the whole canvas page with an ordered list of elements. Prefer this for full-page renders over many single creates.",
  parameters: Schema.Struct({ elements: Schema.Array(CanvasElement) }),
  success: Schema.Struct({ elements: Schema.Array(CanvasElement) }),
})

export const CanvasToolkit = Toolkit.make(
  CanvasCreateElement,
  CanvasUpdateElement,
  CanvasRemoveElement,
  CanvasListElements,
  CanvasClear,
  CanvasSetPage,
)

export { CanvasStyle }
