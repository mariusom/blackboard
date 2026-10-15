import { Config, Context, Effect, Layer, Schema } from "effect"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { Board, type BoardPatch, BoardSummary, type CreateBoard, Workspace, WorkspaceError } from "./model"
import { TokenCollection, type UpsertTokens } from "./tokens"

export const applicationDirectory = () => join(homedir(), "Library", "Application Support", "Blackboard")
export const discoveryPath = () => join(applicationDirectory(), "runtime.json")
const Discovery = Schema.Struct({ origin: Schema.String, token: Schema.String })
const State = Schema.Struct({ workspace: Workspace })

export class CanvasConnection extends Context.Service<
  CanvasConnection,
  {
    readonly list: Effect.Effect<Workspace, WorkspaceError>
    readonly board: (id: string) => Effect.Effect<Board, WorkspaceError>
    readonly search: (query: string) => Effect.Effect<readonly BoardSummary[], WorkspaceError>
    readonly create: (input: CreateBoard) => Effect.Effect<Board, WorkspaceError>
    readonly update: (id: string, patch: BoardPatch) => Effect.Effect<Board, WorkspaceError>
    readonly remove: (id: string, expectedRevision: number) => Effect.Effect<void, WorkspaceError>
    readonly tokens: Effect.Effect<TokenCollection, WorkspaceError>
    readonly upsertTokens: (input: UpsertTokens) => Effect.Effect<TokenCollection, WorkspaceError>
    readonly deleteToken: (name: string, expectedRevision?: number) => Effect.Effect<TokenCollection, WorkspaceError>
  }
>()("blackboard/CanvasConnection") {
  static readonly layer = Layer.effect(
    CanvasConnection,
    Effect.gen(function* () {
      const path = yield* Config.String("BLACKBOARD_CONNECTION_FILE").pipe(Config.withDefault(discoveryPath()))
      const request = <A>(route: string, schema: Schema.Decoder<A>, body?: unknown) =>
        Effect.gen(function* () {
          const discovery = yield* Effect.tryPromise({
            try: async () => JSON.parse(await readFile(path, "utf8")),
            catch: () => new WorkspaceError({ code: "unavailable", message: "Open Blackboard before using its canvas tools." })
          })
          const connection = yield* Schema.decodeUnknownEffect(Discovery)(discovery).pipe(
            Effect.mapError(
              () => new WorkspaceError({ code: "unavailable", message: "Blackboard's connection file is invalid. Relaunch the app." })
            )
          )
          if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(connection.origin))
            return yield* new WorkspaceError({ code: "unavailable", message: "The canvas connection must use the local Blackboard app." })
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(connection.origin + route, {
                method: body === undefined ? "GET" : "POST",
                headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                signal: AbortSignal.timeout(10_000),
                redirect: "error"
              }),
            catch: () => new WorkspaceError({ code: "unavailable", message: "Could not reach Blackboard. Open or relaunch the app." })
          })
          const json: unknown = yield* Effect.tryPromise({
            try: () => response.json(),
            catch: () => new WorkspaceError({ code: "unavailable", message: "Blackboard returned an invalid response." })
          })
          if (!response.ok) {
            const message =
              typeof json === "object" && json !== null && "error" in json && typeof json.error === "string"
                ? json.error
                : "The canvas request failed."
            return yield* new WorkspaceError({ code: response.status === 409 ? "conflict" : "unavailable", message })
          }
          return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
            Effect.mapError(() => new WorkspaceError({ code: "invalid", message: "Blackboard returned invalid canvas data." }))
          )
        })
      return CanvasConnection.of({
        list: request("/api/state", State).pipe(Effect.map(s => s.workspace)),
        board: Effect.fn("CanvasConnection.board")((id: string) => request(`/api/boards/${encodeURIComponent(id)}`, Board)),
        search: Effect.fn("CanvasConnection.search")((query: string) =>
          request(`/api/boards?query=${encodeURIComponent(query)}`, Schema.Array(BoardSummary))
        ),
        create: Effect.fn("CanvasConnection.create")((input: CreateBoard) => request("/api/boards", Board, input)),
        update: Effect.fn("CanvasConnection.update")((id: string, patch: BoardPatch) =>
          request(`/api/boards/${encodeURIComponent(id)}`, Board, patch)
        ),
        remove: Effect.fn("CanvasConnection.remove")((id: string, expectedRevision: number) =>
          request(`/api/boards/${encodeURIComponent(id)}/delete`, Schema.Unknown, { expectedRevision }).pipe(Effect.asVoid)
        ),
        tokens: request("/api/tokens", TokenCollection),
        upsertTokens: Effect.fn("CanvasConnection.upsertTokens")((input: UpsertTokens) => request("/api/tokens", TokenCollection, input)),
        deleteToken: Effect.fn("CanvasConnection.deleteToken")((name: string, expectedRevision?: number) =>
          request("/api/tokens/delete", TokenCollection, { name, expectedRevision })
        )
      })
    })
  )
}
