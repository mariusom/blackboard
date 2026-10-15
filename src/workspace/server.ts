import { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect"
import { APP_VERSION } from "../domain/models"
import { UpdateService, type UpdateDependencies } from "../services/UpdateService"
import { BoardPatch, CreateBoard, DeleteBoard, WorkspaceError } from "./model"
import { WorkspaceService } from "./WorkspaceService"
import { makeUpdatePreview } from "./updatePreview"
import html from "../web/index.html" with { type: "text" }
import css from "../web/style.css" with { type: "text" }

declare const BLACKBOARD_WEB_CLIENT: string | undefined

export async function startWorkspaceServer(options: {
  readonly path?: string
  readonly updates?: Partial<UpdateDependencies>
  readonly agentCommand?: string
  readonly agentArgs?: readonly string[]
  readonly previewUpdates?: boolean
} = {}) {
  // Bun's HTML type declaration describes its bundler entrypoint; this import
  // explicitly uses the text loader. Check that boundary before serving it.
  const page = typeof html === "string" ? html : null
  if (page === null) throw new Error("The workspace document was not embedded as text.")
  const preview = options.previewUpdates ? await Effect.runPromise(makeUpdatePreview) : undefined
  const runtime = ManagedRuntime.make(Layer.mergeAll(
    WorkspaceService.makeLayer({ path: options.path }), preview ? Layer.succeed(UpdateService, preview.service) : UpdateService.makeLayer(options.updates),
  ))
  // Acquire storage before opening a window. Invalid files are preserved.
  await runtime.runPromise(Effect.flatMap(WorkspaceService, s => s.get))
  let script: string
  if (typeof BLACKBOARD_WEB_CLIENT !== "undefined") script = BLACKBOARD_WEB_CLIENT
  else {
    const result = await Bun.build({ entrypoints: [new URL("../web/client.ts", import.meta.url).pathname], target: "browser" })
    if (!result.success) throw new Error(result.logs.join("\n"))
    script = await result.outputs[0].text()
  }
  const token = crypto.randomUUID() + crypto.randomUUID()
  const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const encoder = new TextEncoder()
  const getState = () => runtime.runPromise(Effect.gen(function* () {
    const workspace = yield* WorkspaceService
    const updates = yield* UpdateService
    return { workspace: yield* workspace.get, update: yield* updates.getUpdateState, version: APP_VERSION,
      agent: { command: options.agentCommand ?? "bun", args: options.agentArgs ?? ["run", "mcp"] }, updatePreview: preview !== undefined }
  }))
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } })
  const decode = <A>(schema: Schema.Decoder<A>, input: unknown) => Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() => new WorkspaceError({ code: "invalid", message: "Invalid request. Check the canvas dimensions and content." })),
  )
  const execute = async <A, E>(effect: Effect.Effect<A, E, WorkspaceService | UpdateService>) => {
    const result = await runtime.runPromise(Effect.result(effect))
    if (result._tag === "Success") return json(result.success ?? { ok: true })
    const error = result.failure
    const status = error instanceof WorkspaceError ? ({ conflict: 409, missing: 404, invalid: 400, storage: 500, unavailable: 503 }[error.code]) : 500
    return json({ error: error instanceof Error ? error.message : "The action could not be completed." }, status)
  }
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0, maxRequestBodySize: 4_500_000, idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const origin = `http://127.0.0.1:${server.port}`
      if (url.origin !== origin) return new Response("Invalid host", { status: 403 })
      if (url.pathname === "/" && url.searchParams.get("session") === token) {
        return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": `blackboard=${token}; HttpOnly; SameSite=Strict; Path=/`, "Referrer-Policy": "no-referrer" } })
      }
      const cookie = request.headers.get("cookie")?.split(";").some(part => part.trim() === `blackboard=${token}`)
      const bearer = request.headers.get("authorization") === `Bearer ${token}`
      if (!cookie && !bearer) return new Response("Open this workspace from Blackboard.", { status: 401 })
      if (request.method !== "GET" && (request.headers.get("origin") !== origin && !bearer)) return new Response("Invalid origin", { status: 403 })
      if (request.method === "GET") {
        if (url.pathname === "/") return new Response(page, { headers: {
          "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
          "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        } })
        if (url.pathname === "/client.js") return new Response(script, { headers: { "Content-Type": "text/javascript; charset=utf-8" } })
        if (url.pathname === "/style.css") return new Response(css, { headers: { "Content-Type": "text/css; charset=utf-8" } })
        if (url.pathname === "/api/state") return json(await getState())
        if (url.pathname === "/api/events") {
          let subscriber: ReadableStreamDefaultController<Uint8Array>
          const body = new ReadableStream<Uint8Array>({
            start(controller) { subscriber = controller; subscribers.add(controller); controller.enqueue(encoder.encode(": connected\n\n")) },
            cancel() { subscribers.delete(subscriber) },
          })
          return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } })
        }
      }
      if (request.method === "POST") {
        let body: unknown
        try { body = await request.json() } catch { return json({ error: "The request must contain JSON." }, 400) }
        if (url.pathname === "/api/boards") return execute(Effect.gen(function* () {
          const input = yield* decode(CreateBoard, body)
          return yield* (yield* WorkspaceService).create(input)
        }))
        if (url.pathname === "/api/workspace") return execute(Effect.gen(function* () {
          const input = yield* decode(Schema.Struct({ name: Schema.String }), body)
          yield* (yield* WorkspaceService).rename(input.name)
        }))
        const match = /^\/api\/boards\/([^/]+)(\/delete)?$/.exec(url.pathname)
        if (match) return execute(Effect.gen(function* () {
          const service = yield* WorkspaceService
          if (match[2]) return yield* service.remove(decodeURIComponent(match[1]), (yield* decode(DeleteBoard, body)).expectedRevision)
          return yield* service.update(decodeURIComponent(match[1]), yield* decode(BoardPatch, body))
        }))
        if (url.pathname === "/api/updates/check") return execute(Effect.flatMap(UpdateService, u => u.checkForUpdates))
        if (url.pathname === "/api/updates/replay" && preview) return execute(preview.reset)
        if (url.pathname === "/api/updates/install") return execute(Effect.flatMap(UpdateService, u => u.installUpdate))
        if (url.pathname === "/api/updates/restart") return execute(Effect.flatMap(UpdateService, u => u.restartApp))
        if (url.pathname === "/api/updates/download") return execute(Effect.flatMap(UpdateService, u => u.openDownloadPage))
      }
      return new Response("Not found", { status: 404 })
    },
    error(error) { console.error(error); return json({ error: "The workspace request failed." }, 500) },
  })
  const abort = new AbortController()
  const broadcast = async () => {
    const message = encoder.encode(`data: ${JSON.stringify(await getState())}\n\n`)
    for (const subscriber of subscribers) {
      try { subscriber.enqueue(message) } catch { subscribers.delete(subscriber) }
    }
  }
  const watch = (effect: Effect.Effect<void, never, WorkspaceService | UpdateService>) => {
    void runtime.runPromise(effect, { signal: abort.signal }).catch(error => { if (!abort.signal.aborted) console.error(error) })
  }
  watch(Effect.gen(function* () { yield* Stream.runForEach((yield* WorkspaceService).changes, () => Effect.promise(broadcast)) }))
  watch(Effect.gen(function* () { yield* Stream.runForEach((yield* UpdateService).stateChanges, () => Effect.promise(broadcast)) }))
  return {
    origin: `http://127.0.0.1:${server.port}`, token,
    url: `http://127.0.0.1:${server.port}/?session=${token}`,
    runtime,
    async close() { abort.abort(); for (const subscriber of subscribers) { try { subscriber.close() } catch {} }; subscribers.clear(); await server.stop(true); await runtime.dispose() },
  }
}
