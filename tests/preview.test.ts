import { expect, it } from "bun:test"
import { previewDocument } from "../src/workspace/model"
import { createPreviewRenderer, type PreviewFrame } from "../src/web/preview"

function surface() {
  const frames: Array<{ visible: boolean; loaded: boolean; mounted: boolean; html: string; ready: () => void; paint: () => void }> = []
  const makeFrame = (): PreviewFrame => {
    const frame = { visible: false, loaded: false, mounted: false, html: "", ready: () => {}, paint: () => {} }
    frames.push(frame)
    return {
      setDocument: html => { frame.html = html; frame.loaded = false }, setTitle: () => {},
      onReady: ready => { frame.ready = () => { frame.loaded = true; ready() } },
      afterPaint: painted => { frame.paint = painted },
      mount: hidden => { frame.mounted = true; frame.visible = !hidden },
      show: () => { frame.visible = true }, remove: () => { frame.mounted = false; frame.visible = false },
    }
  }
  return { frames, renderer: createPreviewRenderer(makeFrame), painted: () => frames.filter(frame => frame.mounted && frame.visible && frame.loaded).map(frame => frame.html) }
}

it("keeps the painted canvas visible until the replacement document is ready", () => {
  const s = surface()
  s.renderer.render("original", "Canvas"); s.frames.at(-1)?.ready(); s.frames.at(-1)?.paint()
  expect(s.painted()).toEqual(["original"])
  s.renderer.render("token change", "Canvas")
  expect(s.painted()).toEqual(["original"])
  s.frames.at(-1)?.ready(); s.frames.at(-1)?.paint()
  expect(s.painted()).toEqual(["token change"])
})

it("ignores stale loads during rapid edits and does not reload identical HTML", () => {
  const s = surface()
  s.renderer.render("original", "Canvas"); s.frames.at(-1)?.ready(); s.frames.at(-1)?.paint()
  s.renderer.render("intermediate", "Canvas"); const stale = s.frames.at(-1)
  s.renderer.render("latest", "Canvas"); const latest = s.frames.at(-1)
  stale?.ready()
  expect(s.painted()).toEqual(["original"])
  latest?.ready(); latest?.paint()
  expect(s.painted()).toEqual(["latest"])
  const count = s.frames.length
  s.renderer.render("latest", "Renamed canvas")
  expect(s.frames).toHaveLength(count)
  s.renderer.dispose()
  expect(s.painted()).toEqual([])
})


it("does not expose a loaded replacement before its first paint", () => {
  const s = surface()
  s.renderer.render("original", "Canvas"); s.frames.at(-1)?.ready(); s.frames.at(-1)?.paint()
  s.renderer.render("replacement", "Canvas")
  const replacement = s.frames.at(-1)
  replacement?.ready()
  expect(s.painted()).toEqual(["original"])
  replacement?.paint()
  expect(s.painted()).toEqual(["replacement"])
})


it("does not reload a canvas for unrelated tokens and follows referenced aliases", () => {
  const tokens = [
    { name: "brand", type: "color" as const, value: "#112233" },
    { name: "action", type: "color" as const, value: "var(--brand)" },
    { name: "unused", type: "color" as const, value: "#ffffff" },
  ]
  const html = '<h1 style="color:var(--action)">Linked</h1>'
  const original = previewDocument(html, tokens)
  expect(previewDocument(html, tokens.map(token => token.name === "unused" ? { ...token, value: "#000000" } : token))).toBe(original)
  expect(previewDocument(html, tokens.map(token => token.name === "brand" ? { ...token, value: "#7966e8" } : token))).not.toBe(original)
  expect(original).toContain("--brand: #112233")
  expect(original).not.toContain("--unused")
})
