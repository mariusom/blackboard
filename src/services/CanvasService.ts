import { Context, Effect, Layer, Ref } from "effect"
import {
  CanvasError,
  INITIAL_CANVAS_ELEMENTS,
  type CanvasElement,
  type CanvasElementPatch,
  type CanvasElementTag,
  type CanvasStyle,
} from "../domain/canvas"

export interface CanvasServiceShape {
  readonly listElements: Effect.Effect<readonly CanvasElement[]>
  readonly getElement: (id: string) => Effect.Effect<CanvasElement, CanvasError>
  readonly createElement: (input: {
    readonly tag: CanvasElementTag
    readonly text: string
    readonly subtitle?: string | undefined
    readonly glyph?: string | undefined
    readonly style?: CanvasStyle | undefined
    readonly href?: string | undefined
    readonly id?: string | undefined
  }) => Effect.Effect<CanvasElement>
  readonly updateElement: (
    id: string,
    patch: CanvasElementPatch,
  ) => Effect.Effect<CanvasElement, CanvasError>
  readonly removeElement: (id: string) => Effect.Effect<void, CanvasError>
  readonly clearElements: Effect.Effect<void>
  readonly replaceAll: (
    elements: readonly CanvasElement[],
  ) => Effect.Effect<readonly CanvasElement[]>
}

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "element"

export class CanvasService extends Context.Service<CanvasService, CanvasServiceShape>()(
  "blackboard/CanvasService",
) {
  static readonly layer = Layer.effect(
    CanvasService,
    Effect.gen(function* () {
      const elementsRef = yield* Ref.make<readonly CanvasElement[]>(INITIAL_CANVAS_ELEMENTS)
      const counterRef = yield* Ref.make(INITIAL_CANVAS_ELEMENTS.length + 1)

      const listElements = Ref.get(elementsRef)

      const getElement = Effect.fn("CanvasService.getElement")(function* (id: string) {
        const elements = yield* Ref.get(elementsRef)
        const found = elements.find((el) => el.id === id)
        if (!found) {
          return yield* new CanvasError({ message: `Element '${id}' not found.`, elementId: id })
        }
        return found
      })

      const createElement = Effect.fn("CanvasService.createElement")(function* (input: {
        readonly tag: CanvasElementTag
        readonly text: string
        readonly subtitle?: string | undefined
        readonly glyph?: string | undefined
        readonly style?: CanvasStyle | undefined
        readonly href?: string | undefined
        readonly id?: string | undefined
      }) {
        const n = yield* Ref.updateAndGet(counterRef, (c) => c + 1)
        const id = (input.id?.trim() || `${slugify(input.text)}-${n}`).slice(0, 64)
        const element: CanvasElement = {
          id,
          tag: input.tag,
          text: input.text,
          ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
          ...(input.glyph !== undefined ? { glyph: input.glyph } : {}),
          ...(input.style !== undefined ? { style: input.style } : {}),
          ...(input.href !== undefined ? { href: input.href } : {}),
        }
        yield* Ref.update(elementsRef, (els) =>
          els.some((el) => el.id === id)
            ? els.map((el) => (el.id === id ? element : el))
            : [...els, element],
        )
        yield* Effect.logInfo(`CanvasService: created element '${id}' (${input.tag})`)
        return element
      })

      const updateElement = Effect.fn("CanvasService.updateElement")(function* (
        id: string,
        patch: CanvasElementPatch,
      ) {
        const elements = yield* Ref.get(elementsRef)
        const existing = elements.find((el) => el.id === id)
        if (!existing) {
          return yield* new CanvasError({ message: `Element '${id}' not found.`, elementId: id })
        }
        const updated: CanvasElement = {
          ...existing,
          ...(patch.tag !== undefined ? { tag: patch.tag } : {}),
          ...(patch.text !== undefined ? { text: patch.text } : {}),
          ...(patch.subtitle !== undefined ? { subtitle: patch.subtitle } : {}),
          ...(patch.glyph !== undefined ? { glyph: patch.glyph } : {}),
          ...(patch.style !== undefined ? { style: patch.style } : {}),
          ...(patch.href !== undefined ? { href: patch.href } : {}),
        }
        yield* Ref.update(elementsRef, (els) => els.map((el) => (el.id === id ? updated : el)))
        return updated
      })

      const removeElement = Effect.fn("CanvasService.removeElement")(function* (id: string) {
        const elements = yield* Ref.get(elementsRef)
        if (!elements.some((el) => el.id === id)) {
          return yield* new CanvasError({ message: `Element '${id}' not found.`, elementId: id })
        }
        yield* Ref.update(elementsRef, (els) => els.filter((el) => el.id !== id))
      })

      const clearElements = Ref.set(elementsRef, [])

      const replaceAll = Effect.fn("CanvasService.replaceAll")(function* (
        elements: readonly CanvasElement[],
      ) {
        yield* Ref.set(elementsRef, [...elements])
        return yield* Ref.get(elementsRef)
      })

      return CanvasService.of({
        listElements,
        getElement,
        createElement,
        updateElement,
        removeElement,
        clearElements,
        replaceAll,
      })
    }),
  )
}
