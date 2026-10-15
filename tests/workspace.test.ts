import { expect, it } from "bun:test"
import { Effect, ManagedRuntime, Stream } from "effect"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { WorkspaceService } from "../src/workspace/WorkspaceService"
import { fitBoards, zoomAt, type Board } from "../src/workspace/model"

const input = { name: "Generated canvas", html: "<h1>Hello</h1>", width: 800, height: 600 }
async function withWorkspace(run: (path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "blackboard-workspace-test-"))
  try { await run(join(root, "workspace.json")) } finally { await rm(root, { recursive: true, force: true }) }
}

it("persists HTML, geometry, naming, and deletion across app restarts", () => withWorkspace(async path => {
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer({ path, initial: { version: 1, name: "Test", boards: [] } }))
  const board = await runtime.runPromise(Effect.gen(function* () {
    const workspace = yield* WorkspaceService
    const created = yield* workspace.create(input)
    const updated = yield* workspace.update(created.id, { html: "<h1>Saved HTML</h1>", x: -300, y: 250, width: 900, expectedRevision: created.revision })
    yield* workspace.rename("Design explorations")
    return updated
  }))
  await runtime.dispose()
  const reopened = ManagedRuntime.make(WorkspaceService.makeLayer({ path }))
  try {
    const saved = await reopened.runPromise(Effect.flatMap(WorkspaceService, w => w.get))
    expect(saved.name).toBe("Design explorations")
    expect(saved.boards).toEqual([board])
    await reopened.runPromise(Effect.flatMap(WorkspaceService, w => w.remove(board.id)))
    expect(JSON.parse(await readFile(path, "utf8")).boards).toEqual([])
  } finally { await reopened.dispose() }
}))

it("serializes concurrent creates without dropping canvases or reusing IDs", () => withWorkspace(async path => {
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer({ path, initial: { version: 1, name: "Test", boards: [] } }))
  try {
    const boards = await Promise.all(Array.from({ length: 12 }, (_, index) => runtime.runPromise(Effect.flatMap(WorkspaceService, w => w.create({ ...input, name: String(index) })))))
    const saved = await runtime.runPromise(Effect.flatMap(WorkspaceService, w => w.get))
    expect(saved.boards).toHaveLength(12)
    expect(new Set(boards.map(b => b.id)).size).toBe(12)
    expect(new Set(boards.map(b => b.x)).size).toBe(12)
  } finally { await runtime.dispose() }
}))

it("rejects stale HTML edits while allowing partial geometry changes to preserve generated content", async () => {
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer())
  try {
    const result = await runtime.runPromise(Effect.gen(function* () {
      const workspace = yield* WorkspaceService
      const created = yield* workspace.create(input)
      yield* workspace.update(created.id, { html: "<h1>Agent change</h1>", expectedRevision: 0 })
      const stale = yield* Effect.result(workspace.update(created.id, { html: "<h1>Old draft</h1>", expectedRevision: 0 }))
      const moved = yield* workspace.update(created.id, { x: 500 })
      return { stale, moved }
    }))
    expect(result.stale._tag).toBe("Failure")
    if (result.stale._tag === "Failure") expect(result.stale.failure.code).toBe("conflict")
    expect(result.moved.html).toBe("<h1>Agent change</h1>")
    expect(result.moved.x).toBe(500)
  } finally { await runtime.dispose() }
})

it("keeps the previous saved versions as a rotating ring of backups", () => withWorkspace(async path => {
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer({ path }))
  try {
    await runtime.runPromise(Effect.gen(function* () {
      const workspace = yield* WorkspaceService
      const board = yield* workspace.create({ ...input, name: "First" })
      yield* workspace.update(board.id, { name: "Second" })
      yield* workspace.update(board.id, { name: "Third" })
    }))
  } finally { await runtime.dispose() }
  expect(JSON.parse(await readFile(path, "utf8")).boards[0].name).toBe("Third")
  expect(JSON.parse(await readFile(`${path}.1.bak`, "utf8")).boards[0].name).toBe("Second")
  expect(JSON.parse(await readFile(`${path}.2.bak`, "utf8")).boards[0].name).toBe("First")
}))

it("bounds the backup ring and leaves no temporary files behind", () => withWorkspace(async path => {
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer({ path }))
  try {
    await runtime.runPromise(Effect.gen(function* () {
      const workspace = yield* WorkspaceService
      const board = yield* workspace.create(input)
      for (let index = 0; index < 8; index++) yield* workspace.update(board.id, { x: index })
    }))
  } finally { await runtime.dispose() }
  const entries = await readdir(dirname(path))
  expect(entries.filter(name => name.endsWith(".tmp"))).toEqual([])
  expect(entries).toContain("workspace.json.5.bak")
  expect(entries).not.toContain("workspace.json.6.bak")
}))

it("broadcasts committed state to a live canvas subscription", async () => {
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer())
  const subscribed = Promise.withResolvers<void>()
  const seen = runtime.runPromise(Effect.gen(function* () {
    const workspace = yield* WorkspaceService
    return yield* workspace.changes.pipe(Stream.tap(() => Effect.sync(() => subscribed.resolve())), Stream.take(2), Stream.runCollect)
  }))
  try {
    await subscribed.promise
    const board = await runtime.runPromise(Effect.flatMap(WorkspaceService, w => w.create(input)))
    const events = await seen
    expect(events[1].boards.at(-1)?.id).toBe(board.id)
  } finally { await runtime.dispose() }
})

it("preserves canvas IDs during undo restoration and protects deletion against concurrent edits", async () => {
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer())
  try {
    const result = await runtime.runPromise(Effect.gen(function* () {
      const workspace = yield* WorkspaceService
      const original = yield* workspace.create(input)
      const changed = yield* workspace.update(original.id, { html: "<h1>New work</h1>" })
      const staleDelete = yield* Effect.result(workspace.remove(original.id, original.revision))
      yield* workspace.remove(changed.id, changed.revision)
      const restored = yield* workspace.create(changed)
      const duplicateId = yield* Effect.result(workspace.create(changed))
      const staleEdit = yield* Effect.result(workspace.update(restored.id, { html: "<h1>Old agent work</h1>", expectedRevision: original.revision }))
      return { original, restored, staleDelete, duplicateId, staleEdit }
    }))
    expect(result.restored.id).toBe(result.original.id)
    expect(result.restored.html).toBe("<h1>New work</h1>")
    expect(result.staleDelete._tag).toBe("Failure")
    expect(result.duplicateId._tag).toBe("Failure")
    expect(result.staleEdit._tag).toBe("Failure")
  } finally { await runtime.dispose() }
})

it("preserves a damaged workspace instead of silently replacing it", () => withWorkspace(async path => {
  const damaged = '{"version":1,"boards":invalid'
  await writeFile(path, damaged)
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer({ path }))
  try { await expect(runtime.runPromise(Effect.flatMap(WorkspaceService, w => w.get))).rejects.toThrow("preserved") }
  finally { await runtime.dispose() }
  expect(await readFile(path, "utf8")).toBe(damaged)
}))

it("keeps live state unchanged when saving fails and rejects invalid dimensions", () => withWorkspace(async path => {
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer({ path: join(path, "cannot", "write.json") }))
  try {
    const result = await runtime.runPromise(Effect.gen(function* () {
      const workspace = yield* WorkspaceService
      const before = yield* workspace.get
      yield* Effect.promise(() => writeFile(path, "a file blocks the parent directory"))
      const failed = yield* Effect.result(workspace.create(input))
      const invalid = yield* Effect.result(workspace.create({ ...input, width: -1 }))
      return { before, failed, invalid, after: yield* workspace.get }
    }))
    expect(result.failed._tag).toBe("Failure")
    expect(result.invalid._tag).toBe("Failure")
    expect(result.after).toEqual(result.before)
  } finally { await runtime.dispose() }
}))

it("keeps the point under the cursor stationary while zooming and fits negative canvas positions", () => {
  const camera = { x: -250, y: 70, zoom: .8 }, point = { x: 600, y: 400 }
  const next = zoomAt(camera, 1.6, point)
  expect((point.x - next.x) / next.zoom).toBe((point.x - camera.x) / camera.zoom)
  expect((point.y - next.y) / next.zoom).toBe((point.y - camera.y) / camera.zoom)
  const boards: Board[] = [{ ...input, id: "a", x: -1200, y: -500, revision: 0 }, { ...input, id: "b", x: 50, y: 100, revision: 0 }]
  const fit = fitBoards(boards, 1400, 900)
  for (const b of boards) {
    expect(b.x * fit.zoom + fit.x).toBeGreaterThan(0)
    expect((b.x + b.width) * fit.zoom + fit.x).toBeLessThan(1400)
    expect(b.y * fit.zoom + fit.y).toBeGreaterThan(0)
    expect((b.y + b.height) * fit.zoom + fit.y).toBeLessThan(900)
  }
})
