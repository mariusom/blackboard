import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { CanvasService } from "../src/services/CanvasService"
import { appRuntime } from "../src/services/AppRuntime"

describe("CanvasService", () => {
  it("starts with seed elements and creates/updates/removes", async () => {
    const result = await appRuntime.runPromise(
      Effect.gen(function* () {
        const canvas = yield* CanvasService
        yield* canvas.replaceAll([])
        const empty = yield* canvas.listElements
        const created = yield* canvas.createElement({
          tag: "h1",
          text: "Test heading",
          glyph: "✦",
          style: { fontSize: 24 },
        })
        const updated = yield* canvas.updateElement(created.id, { text: "Updated heading" })
        const listed = yield* canvas.listElements
        yield* canvas.removeElement(created.id)
        const afterRemove = yield* canvas.listElements
        const missing = yield* Effect.exit(canvas.getElement("nope"))
        return { empty, created, updated, listed, afterRemove, missing }
      }),
    )

    expect(result.empty.length).toBe(0)
    expect(result.created.tag).toBe("h1")
    expect(result.updated.text).toBe("Updated heading")
    expect(result.listed.length).toBe(1)
    expect(result.afterRemove.length).toBe(0)
    expect(result.missing._tag).toBe("Failure")
  })

  it("replaces the whole page via replaceAll", async () => {
    const result = await appRuntime.runPromise(
      Effect.gen(function* () {
        const canvas = yield* CanvasService
        const next = yield* canvas.replaceAll([
          { id: "a", tag: "h1", text: "A" },
          { id: "b", tag: "p", text: "B" },
        ])
        return next
      }),
    )
    expect(result.map((el) => el.id)).toEqual(["a", "b"])
  })
})
