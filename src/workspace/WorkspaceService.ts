import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { Context, Effect, Layer, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
import { Board, BoardPatch, CreateBoard, SavedWorkspace, Workspace, WorkspaceError, type LegacyWorkspace } from "./model"
import { INITIAL_WORKSPACE, LEGACY_STUDIO_HTML, STUDIO_HTML } from "./templates"
import { DEFAULT_TOKENS, DeleteToken, TokenList, UpsertTokens, tokenReferences, tokenValidationError, type TokenCollection } from "./tokens"

export interface WorkspaceServiceShape {
  readonly get: Effect.Effect<Workspace>
  readonly changes: Stream.Stream<Workspace>
  readonly create: (input: CreateBoard) => Effect.Effect<Board, WorkspaceError>
  readonly update: (id: string, patch: BoardPatch) => Effect.Effect<Board, WorkspaceError>
  readonly remove: (id: string, expectedRevision?: number) => Effect.Effect<void, WorkspaceError>
  readonly rename: (name: string) => Effect.Effect<void, WorkspaceError>
  readonly getTokens: Effect.Effect<TokenCollection>
  readonly upsertTokens: (input: UpsertTokens) => Effect.Effect<TokenCollection, WorkspaceError>
  readonly deleteToken: (name: string, expectedRevision?: number) => Effect.Effect<TokenCollection, WorkspaceError>
}

export class WorkspaceService extends Context.Service<WorkspaceService, WorkspaceServiceShape>()("blackboard/WorkspaceService") {
  static readonly makeLayer = (options: { readonly path?: string; readonly initial?: Workspace | LegacyWorkspace } = {}) =>
    Layer.effect(WorkspaceService, Effect.gen(function* () {
      const decode = <A>(schema: Schema.Decoder<A>, input: unknown) => Schema.decodeUnknownEffect(schema)(input).pipe(
        Effect.mapError(() => new WorkspaceError({ code: "invalid", message: "The workspace data is invalid." })),
      )
      const upgrade = (saved: Workspace | LegacyWorkspace): Workspace => saved.version === 2 ? saved : {
        ...saved, version: 2, tokens: DEFAULT_TOKENS, tokensRevision: 0,
        boards: saved.boards.map(board => board.html === LEGACY_STUDIO_HTML ? { ...board, html: STUDIO_HTML, revision: board.revision + 1 } : board),
      }
      let initial = upgrade(yield* decode(SavedWorkspace, options.initial ?? INITIAL_WORKSPACE))
      const savedPath = options.path
      if (savedPath) {
        const contents = yield* Effect.tryPromise({
          try: async () => {
            try { return await readFile(savedPath, "utf8") }
            catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error }
          },
          catch: () => new WorkspaceError({ code: "storage", message: "Could not read the saved workspace." }),
        })
        if (contents !== null) {
          const json = yield* Effect.try({ try: () => JSON.parse(contents), catch: () => new WorkspaceError({ code: "invalid", message: "The saved workspace is damaged. Its file has been preserved." }) })
          initial = upgrade(yield* decode(SavedWorkspace, json))
        }
      }
      const invalidTokens = tokenValidationError(initial.tokens)
      if (invalidTokens) return yield* new WorkspaceError({ code: "invalid", message: invalidTokens })
      const state = yield* SubscriptionRef.make(initial)
      // Keep deleted IDs' revisions for undo restoration. A stale agent edit
      // must not become valid again when that same canvas ID is restored.
      const revisions = new Map(initial.boards.map(board => [board.id, board.revision]))
      const lock = yield* Semaphore.make(1)
      const commit = Effect.fn("Workspace.commit")(function* (next: Workspace) {
        yield* decode(Workspace, next)
        const filePath = options.path
        if (filePath) {
          yield* Effect.tryPromise({
            try: async () => {
              await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
              const temporary = `${filePath}.${crypto.randomUUID()}.tmp`
              await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
              await rename(temporary, filePath)
            },
            catch: () => new WorkspaceError({ code: "storage", message: "Could not save the workspace. Your change has not been committed." }),
          })
        }
        yield* Effect.sync(() => { for (const board of next.boards) revisions.set(board.id, board.revision) })
        yield* SubscriptionRef.set(state, next)
      })
      const create = Effect.fn("Workspace.create")(function* (input: CreateBoard) {
        const value = yield* decode(CreateBoard, input)
        const current = yield* SubscriptionRef.get(state)
        if (current.boards.length >= 200) return yield* new WorkspaceError({ code: "invalid", message: "A workspace can contain up to 200 canvases." })
        const id = value.id ?? crypto.randomUUID()
        if (current.boards.some(b => b.id === id)) return yield* new WorkspaceError({ code: "conflict", message: "A canvas with this ID already exists." })
        const board: Board = { ...value, id, x: value.x ?? current.boards.reduce((right, b) => Math.max(right, b.x + b.width + 80), 0), y: value.y ?? 0, width: value.width ?? 760, height: value.height ?? 560, revision: (revisions.get(id) ?? -1) + 1 }
        yield* commit({ ...current, boards: [...current.boards, board] })
        return board
      }, lock.withPermit)
      const update = Effect.fn("Workspace.update")(function* (id: string, patch: BoardPatch) {
        const { expectedRevision, ...fields } = yield* decode(BoardPatch, patch)
        const current = yield* SubscriptionRef.get(state)
        const existing = current.boards.find(b => b.id === id)
        if (!existing) return yield* new WorkspaceError({ code: "missing", message: "This canvas no longer exists." })
        if (expectedRevision !== undefined && expectedRevision !== existing.revision) return yield* new WorkspaceError({ code: "conflict", message: "This canvas changed elsewhere. Your draft is still in the editor; copy it before reloading." })
        const board = yield* decode(Board, { ...existing, ...fields, revision: existing.revision + 1 })
        yield* commit({ ...current, boards: current.boards.map(b => b.id === id ? board : b) })
        return board
      }, lock.withPermit)
      const remove = Effect.fn("Workspace.remove")(function* (id: string, expectedRevision?: number) {
        const current = yield* SubscriptionRef.get(state)
        const existing = current.boards.find(b => b.id === id)
        if (!existing) return yield* new WorkspaceError({ code: "missing", message: "This canvas no longer exists." })
        if (expectedRevision !== undefined && expectedRevision !== existing.revision) return yield* new WorkspaceError({ code: "conflict", message: "This canvas changed elsewhere. Review its latest content before deleting it." })
        yield* commit({ ...current, boards: current.boards.filter(b => b.id !== id) })
      }, lock.withPermit)
      const renameWorkspace = Effect.fn("Workspace.rename")(function* (name: string) {
        const current = yield* SubscriptionRef.get(state)
        yield* commit({ ...current, name })
      }, lock.withPermit)
      const collection = (workspace: Workspace): TokenCollection => ({ tokens: workspace.tokens, revision: workspace.tokensRevision })
      const checkTokenRevision = (workspace: Workspace, expected?: number) => expected !== undefined && expected !== workspace.tokensRevision
        ? Effect.fail(new WorkspaceError({ code: "conflict", message: "The token library changed elsewhere. Reload it before saving your draft." })) : Effect.void
      const upsertTokens = Effect.fn("Workspace.upsertTokens")(function* (input: UpsertTokens) {
        const value = yield* decode(UpsertTokens, input)
        const current = yield* SubscriptionRef.get(state)
        yield* checkTokenRevision(current, value.expectedRevision)
        if (new Set(value.tokens.map(token => token.name)).size !== value.tokens.length) return yield* new WorkspaceError({ code: "invalid", message: "Each token name must be unique." })
        const merged = new Map(current.tokens.map(token => [token.name, token]))
        for (const token of value.tokens) {
          const { category, ...fields } = token
          merged.set(token.name, { ...fields, value: token.value.trim(), ...(category?.trim() ? { category: category.trim() } : {}) })
        }
        const tokens = yield* decode(TokenList, [...merged.values()])
        const error = tokenValidationError(tokens)
        if (error) return yield* new WorkspaceError({ code: "invalid", message: error })
        if (JSON.stringify(tokens) === JSON.stringify(current.tokens)) return collection(current)
        const next: Workspace = { ...current, tokens, tokensRevision: current.tokensRevision + 1 }
        yield* commit(next)
        return collection(next)
      }, lock.withPermit)
      const deleteToken = Effect.fn("Workspace.deleteToken")(function* (name: string, expectedRevision?: number) {
        yield* decode(DeleteToken, { name, ...(expectedRevision === undefined ? {} : { expectedRevision }) })
        const current = yield* SubscriptionRef.get(state)
        yield* checkTokenRevision(current, expectedRevision)
        if (!current.tokens.some(token => token.name === name)) return yield* new WorkspaceError({ code: "missing", message: "This token no longer exists." })
        const boards = current.boards.filter(board => tokenReferences(board.html).includes(name))
        const aliases = current.tokens.filter(token => tokenReferences(token.value).includes(name))
        if (boards.length || aliases.length) return yield* new WorkspaceError({ code: "conflict", message: `Token '${name}' is used by ${boards.length} canvas(es) and ${aliases.length} token(s). Replace those references before deleting it.` })
        const next: Workspace = { ...current, tokens: current.tokens.filter(token => token.name !== name), tokensRevision: current.tokensRevision + 1 }
        yield* commit(next)
        return collection(next)
      }, lock.withPermit)
      return WorkspaceService.of({ get: SubscriptionRef.get(state), changes: SubscriptionRef.changes(state), create, update, remove, rename: renameWorkspace,
        getTokens: SubscriptionRef.get(state).pipe(Effect.map(collection)), upsertTokens, deleteToken })
    }))
}
