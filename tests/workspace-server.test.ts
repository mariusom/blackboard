import { expect, it } from "bun:test"
import { ConfigProvider, Effect, Layer, ManagedRuntime, Schema } from "effect"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { startWorkspaceServer } from "../src/workspace/server"
import { CanvasConnection } from "../src/workspace/connection"
import { Board, BoardSummary } from "../src/workspace/model"
import { WorkspaceState, StreamedWorkspaceState } from "../src/workspace/protocol"
import type { UpdateDependencies } from "../src/services/UpdateService"

async function fixture(run: (server: Awaited<ReturnType<typeof startWorkspaceServer>>, root: string) => Promise<void>, updates: Partial<UpdateDependencies> = {}) {
  const root = await mkdtemp(join(tmpdir(), "blackboard-server-test-"))
  const server = await startWorkspaceServer({ path: join(root, "workspace.json"), updates: { publicKey: "test-key", execPath: "/Applications/Blackboard.app/Contents/MacOS/blackboard", platform: "darwin", checkUpdate: async () => null, relaunch: async () => {}, openExternal: async () => {}, ...updates } })
  try { await run(server, root) } finally { await server.close(); await rm(root, { recursive: true, force: true }) }
}
const headers = (token: string) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" })

it("requires the local session and rejects cross-origin writes from a sandboxed canvas", () => fixture(async server => {
  expect((await fetch(`${server.origin}/api/state`)).status).toBe(401)
  const signIn = await fetch(server.url, { redirect: "manual" })
  expect(signIn.status).toBe(303)
  const cookie = signIn.headers.get("set-cookie")?.split(";")[0] ?? ""
  expect(signIn.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Strict")
  expect((await fetch(`${server.origin}/api/boards`, { method: "POST", headers: { Cookie: cookie, Origin: "null" }, body: "{}" })).status).toBe(403)
  const page = await fetch(server.origin, { headers: { Cookie: cookie } })
  expect(page.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'")
  expect(await page.text()).toContain('id="viewport"')
}))

it("shares generated HTML between a separate MCP connection and the desktop's saved state", () => fixture(async (server, root) => {
  const discovery = join(root, "runtime.json")
  await writeFile(discovery, JSON.stringify({ origin: server.origin, token: server.token }))
  const runtime = ManagedRuntime.make(CanvasConnection.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ BLACKBOARD_CONNECTION_FILE: discovery })))))
  try {
    const board = await runtime.runPromise(Effect.gen(function* () {
      const connection = yield* CanvasConnection
      const created = yield* connection.create({ name: "Agent design", html: "<style>body{background:green}</style><h1>From MCP</h1>" })
      return yield* connection.update(created.id, { html: "<h1>Updated by agent</h1>", expectedRevision: created.revision })
    }))
    const response = await fetch(`${server.origin}/api/state`, { headers: headers(server.token) })
    const state = Schema.decodeUnknownSync(WorkspaceState)(await response.json())
    expect(state.workspace.boards.find(b => b.id === board.id)).toEqual(board)
    expect(JSON.parse(await readFile(join(root, "workspace.json"), "utf8")).boards.at(-1).html).toContain("Updated by agent")
  } finally { await runtime.dispose() }
}))

it("returns conflicts for stale HTML and validates request payloads before saving", () => fixture(async server => {
  const post = (path: string, body: unknown) => fetch(server.origin + path, { method: "POST", headers: headers(server.token), body: JSON.stringify(body) })
  const created = Schema.decodeUnknownSync(Board)(await (await post("/api/boards", { name: "Test", html: "<h1>One</h1>" })).json())
  expect((await post(`/api/boards/${created.id}`, { html: "<h1>Two</h1>", expectedRevision: 0 })).status).toBe(200)
  expect((await post(`/api/boards/${created.id}`, { html: "<h1>Stale</h1>", expectedRevision: 0 })).status).toBe(409)
  expect((await post(`/api/boards/${created.id}`, { width: 1 })).status).toBe(400)
  expect((await post("/api/boards/not-found", { name: "Missing" })).status).toBe(404)
}))

it("streams generated canvas changes to an open workspace", () => fixture(async server => {
  const abort = new AbortController()
  const response = await fetch(`${server.origin}/api/events`, { headers: headers(server.token), signal: abort.signal })
  const reader = response.body?.getReader(); if (!reader) throw new Error("No event stream")
  await reader.read()
  try {
    const created = await fetch(`${server.origin}/api/boards`, { method: "POST", headers: headers(server.token), body: JSON.stringify({ name: "Live canvas", html: "<h1>Live event</h1>" }) })
    expect(created.status).toBe(200)
    let received = ""
    while (!received.includes("Live event")) { const chunk = await reader.read(); if (chunk.done) throw new Error("Stream ended early"); received += new TextDecoder().decode(chunk.value) }
    expect(received).toContain("Live canvas")
  } finally { abort.abort(); await reader.cancel().catch(() => {}) }
}))

it("keeps update download progress and restart actions functional through the new web UI API", async () => {
  const started = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>()
  let restarts = 0
  await fixture(async server => {
    const post = (action: string) => fetch(`${server.origin}/api/updates/${action}`, { method: "POST", headers: headers(server.token), body: "{}" })
    const checked = await post("check"); expect(checked.status).toBe(200)
    const install = post("install"); await started.promise
    const state = Schema.decodeUnknownSync(WorkspaceState)(await (await fetch(`${server.origin}/api/state`, { headers: headers(server.token) })).json())
    expect(state.update.status).toBe("downloading")
    finish.resolve(); expect((await install).status).toBe(200)
    const ready = Schema.decodeUnknownSync(WorkspaceState)(await (await fetch(`${server.origin}/api/state`, { headers: headers(server.token) })).json())
    expect(ready.update.status).toBe("ready-to-restart")
    expect((await post("restart")).status).toBe(200); expect(restarts).toBe(1)
  }, { checkUpdate: async () => ({ version: "9.9.9", format: "app", downloadUrl: "https://example.com/update.app.tar.gz", downloadAndInstall: async () => { started.resolve(); await finish.promise } }), relaunch: async () => { restarts++ } })
})

it("lists and searches canvases by name and content without sending their HTML", () => fixture(async server => {
  const post = (path: string, body: unknown) => fetch(server.origin + path, { method: "POST", headers: headers(server.token), body: JSON.stringify(body) })
  await post("/api/boards", { name: "Landing page", html: "<h1>Welcome</h1>" })
  await post("/api/boards", { name: "Mobile app", html: '<main class="hero">Pricing</main>' })
  const list = async (query = "") => Schema.decodeUnknownSync(Schema.Array(BoardSummary))(await (await fetch(`${server.origin}/api/boards${query}`, { headers: headers(server.token) })).json())
  const all = await list()
  expect(all).toHaveLength(2)
  expect(all.every(board => !("html" in board))).toBe(true)
  expect((await list("?query=landing")).map(board => board.name)).toEqual(["Landing page"])
  expect((await list("?query=pricing")).map(board => board.name)).toEqual(["Mobile app"])
  expect(await list("?query=absent")).toEqual([])
}))

it("omits unchanged canvas HTML from later stream frames", () => fixture(async server => {
  const post = (path: string, body: unknown) => fetch(server.origin + path, { method: "POST", headers: headers(server.token), body: JSON.stringify(body) })
  const created = Schema.decodeUnknownSync(Board)(await (await post("/api/boards", { name: "Stats", html: "<h1>First</h1>" })).json())
  const abort = new AbortController()
  const response = await fetch(`${server.origin}/api/events`, { headers: headers(server.token), signal: abort.signal })
  const reader = response.body?.getReader(); if (!reader) throw new Error("No event stream")
  const nextFrame = async () => {
    let buffer = ""
    while (true) {
      const chunk = await reader.read(); if (chunk.done) throw new Error("Stream ended early")
      buffer += new TextDecoder().decode(chunk.value)
      const end = buffer.indexOf("\n\n"); if (end === -1) continue
      const line = buffer.slice(0, end).split("\n").find(entry => entry.startsWith("data: "))
      if (line) return Schema.decodeUnknownSync(StreamedWorkspaceState)(JSON.parse(line.slice("data: ".length)))
    }
  }
  try {
    await reader.read()
    await post("/api/workspace", { name: "Renamed once" })
    const first = await nextFrame()
    expect(first.workspace.boards.find(board => board.id === created.id)?.html).toBe("<h1>First</h1>")
    await post("/api/workspace", { name: "Renamed twice" })
    const second = await nextFrame()
    expect(second.workspace.boards.find(board => board.id === created.id)?.html).toBeNull()
    await post(`/api/boards/${created.id}`, { html: "<h1>Edited</h1>" })
    const third = await nextFrame()
    expect(third.workspace.boards.find(board => board.id === created.id)?.html).toBe("<h1>Edited</h1>")
  } finally { abort.abort(); await reader.cancel().catch(() => {}) }
}))

it("serves a single canvas by id so an agent read does not download every board", () => fixture(async server => {
  const post = (path: string, body: unknown) => fetch(server.origin + path, { method: "POST", headers: headers(server.token), body: JSON.stringify(body) })
  const created = Schema.decodeUnknownSync(Board)(await (await post("/api/boards", { name: "Only me", html: "<h1>One</h1>" })).json())
  await post("/api/boards", { name: "Another", html: "<h1>Two</h1>" })
  const read = await fetch(`${server.origin}/api/boards/${created.id}`, { headers: headers(server.token) })
  expect(read.status).toBe(200)
  expect(Schema.decodeUnknownSync(Board)(await read.json())).toEqual(created)
  expect((await fetch(`${server.origin}/api/boards/missing`, { headers: headers(server.token) })).status).toBe(404)
}))

it("guards canvas deletion behind the revision the agent last read", () => fixture(async (server, root) => {
  const discovery = join(root, "runtime.json")
  await writeFile(discovery, JSON.stringify({ origin: server.origin, token: server.token }))
  const runtime = ManagedRuntime.make(CanvasConnection.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ BLACKBOARD_CONNECTION_FILE: discovery })))))
  try {
    const result = await runtime.runPromise(Effect.gen(function* () {
      const connection = yield* CanvasConnection
      const created = yield* connection.create({ name: "Agent design", html: "<h1>One</h1>" })
      const updated = yield* connection.update(created.id, { html: "<h1>Two</h1>", expectedRevision: created.revision })
      const stale = yield* Effect.result(connection.remove(created.id, created.revision))
      const missing = yield* Effect.result(connection.remove("does-not-exist"))
      yield* connection.remove(created.id, updated.revision)
      return { stale, missing, boards: (yield* connection.list).boards.length }
    }))
    expect(result.stale._tag).toBe("Failure")
    if (result.stale._tag === "Failure") expect(result.stale.failure.code).toBe("conflict")
    expect(result.missing._tag).toBe("Failure")
    expect(result.boards).toBe(0)
  } finally { await runtime.dispose() }
}))

it("serves actual MCP tools over stdio and writes through to the open desktop workspace", () => fixture(async (server, root) => {
  const path = join(root, "runtime.json")
  await writeFile(path, JSON.stringify({ origin: server.origin, token: server.token }))
  const child = Bun.spawn([process.execPath, resolve("src/mcp-main.ts"), `--connection-file=${path}`], { env: process.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>()
  let id = 0
  const read = (async () => {
    let buffer = ""
    for await (const chunk of child.stdout) {
      buffer += new TextDecoder().decode(chunk)
      let end: number
      while ((end = buffer.indexOf("\n")) !== -1) {
        const packet = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1)
        if (typeof packet.id === "number") { const handler = waiting.get(packet.id); waiting.delete(packet.id); if (packet.error) handler?.reject(packet.error); else handler?.resolve(packet.result) }
      }
    }
  })()
  const rpc = (method: string, params?: unknown) => new Promise<unknown>((resolve, reject) => {
    const next = ++id; waiting.set(next, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: next, method, ...(params === undefined ? {} : { params }) }) + "\n")
  })
  try {
    await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "blackboard-integration-test", version: "1" } })
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    const tools = await rpc("tools/list")
    expect(JSON.stringify(tools)).toContain("canvas_create_board")
    expect(JSON.stringify(tools)).toContain("canvas_search")
    expect(JSON.stringify(tools)).toContain("canvas_upsert_tokens")
    const tokens = await rpc("tools/call", { name: "canvas_upsert_tokens", arguments: { tokens: [{ name: "test-brand", type: "color", value: "#123456" }], expectedRevision: 0 } })
    expect(JSON.stringify(tokens)).not.toContain('"isError":true')
    expect(JSON.stringify(await rpc("tools/call", { name: "canvas_list_tokens", arguments: {} }))).toContain("test-brand")
    const stale = await rpc("tools/call", { name: "canvas_upsert_tokens", arguments: { tokens: [{ name: "test-brand", type: "color", value: "#ffffff" }], expectedRevision: 0 } })
    expect(JSON.stringify(stale)).toContain('"isError":true')
    const result = await rpc("tools/call", { name: "canvas_create_board", arguments: { name: "MCP round trip", html: "<h1>MCP is live</h1>", width: 600, height: 400 } })
    expect(JSON.stringify(result)).not.toContain('"isError":true')
    const state = Schema.decodeUnknownSync(WorkspaceState)(await (await fetch(`${server.origin}/api/state`, { headers: headers(server.token) })).json())
    expect(state.workspace.boards.at(-1)?.html).toBe("<h1>MCP is live</h1>")
    expect(state.workspace.tokens.find(token => token.name === "test-brand")?.value).toBe("#123456")
    expect(state.workspace.tokensRevision).toBe(1)
  } finally { child.kill(); await child.exited; await read }
}), 15_000)
