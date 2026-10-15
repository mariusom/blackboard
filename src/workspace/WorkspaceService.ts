import { copyFile, link, mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { dirname } from "node:path"
import { Context, Effect, Layer, Schema, Semaphore, type Stream, SubscriptionRef } from "effect"
import { Board, BoardPatch, CreateBoard, SavedWorkspace, Workspace, WorkspaceError, type LegacyWorkspace } from "./model"
import { EMPTY_WORKSPACE, LEGACY_STUDIO_HTML, STUDIO_HTML } from "./templates"
import { DEFAULT_TOKENS, DeleteToken, TokenList, UpsertTokens, tokenReferences, tokenValidationError, type TokenCollection } from "./tokens"

/** The saved workspace is the app's only durable copy, so commits are made
 * durable with fsync before the atomic rename, and the previous versions are
 * kept as a small ring of recovery snapshots. */
export const MAX_WORKSPACE_BYTES = 32 * 1024 * 1024
export const WORKSPACE_BACKUP_COUNT = 5
const backupPath = (filePath: string, index: number) => `${filePath}.${index}.bak`
const missingFile = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT"
const moveIfPresent = async (from: string, to: string) => {
  try {
    await rename(from, to)
  } catch (error) {
    if (!missingFile(error)) throw error
  }
}
async function writeDurably(filePath: string, contents: string) {
  const handle = await open(filePath, "wx", 0o600)
  try {
    await handle.writeFile(contents)
    await handle.sync()
  } finally {
    await handle.close()
  }
}
/** Record the current file as `.1.bak` and shift older snapshots down the ring.
 * The primary is only replaced by the caller's atomic rename: snapshots are
 * hard links, so rotation never leaves the workspace file missing. */
export async function rotateWorkspaceBackups(filePath: string) {
  for (let index = WORKSPACE_BACKUP_COUNT; index >= 2; index--)
    await moveIfPresent(backupPath(filePath, index - 1), backupPath(filePath, index))
  await rm(backupPath(filePath, 1), { force: true })
  await linkOrCopy(filePath, backupPath(filePath, 1))
}
/** Hard links are cheap and keep the primary in place, so an interrupted
 * rotation can never remove the only copy of the workspace. Fall back to a
 * copy where the filesystem refuses links. */
async function linkOrCopy(from: string, to: string) {
  try {
    await link(from, to)
    return
  } catch (error) {
    if (missingFile(error)) return
  }
  try {
    await copyFile(from, to)
  } catch (error) {
    if (!missingFile(error)) throw error
  }
}
/** Read the workspace, falling back to the newest snapshot when the primary is
 * missing (for example after an interrupted write). */
async function readSavedWorkspace(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8")
  } catch (error) {
    if (!missingFile(error)) throw error
  }
  for (let index = 1; index <= WORKSPACE_BACKUP_COUNT; index++) {
    try {
      return await readFile(backupPath(filePath, index), "utf8")
    } catch (error) {
      if (!missingFile(error)) throw error
    }
  }
  return null
}
/** Directory fsync makes the rename itself durable. Unsupported on some
 * platforms (notably macOS directories), where the file's own fsync is the
 * strongest guarantee available, so a failure here is not fatal. */
async function syncDirectory(directory: string) {
  try {
    const handle = await open(directory, "r")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {}
}

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
  static readonly makeLayer = (
    options: { readonly path?: string; readonly initial?: Workspace | LegacyWorkspace; readonly maxBytes?: number } = {}
  ) =>
    Layer.effect(
      WorkspaceService,
      Effect.gen(function* () {
        const decode = <A>(schema: Schema.Decoder<A>, input: unknown) =>
          Schema.decodeUnknownEffect(schema)(input).pipe(
            Effect.mapError(() => new WorkspaceError({ code: "invalid", message: "The workspace data is invalid." }))
          )
        const maxBytes = options.maxBytes ?? MAX_WORKSPACE_BYTES
        const upgrade = (saved: Workspace | LegacyWorkspace): Workspace =>
          saved.version === 2
            ? saved
            : {
                ...saved,
                version: 2,
                tokens: DEFAULT_TOKENS,
                tokensRevision: 0,
                boards: saved.boards.map(board =>
                  board.html === LEGACY_STUDIO_HTML ? { ...board, html: STUDIO_HTML, revision: board.revision + 1 } : board
                )
              }
        let initial = upgrade(yield* decode(SavedWorkspace, options.initial ?? EMPTY_WORKSPACE))
        const savedPath = options.path
        if (savedPath) {
          const contents = yield* Effect.tryPromise({
            try: () => readSavedWorkspace(savedPath),
            catch: () => new WorkspaceError({ code: "storage", message: "Could not read the saved workspace." })
          })
          if (contents !== null) {
            const json = yield* Effect.try({
              try: () => JSON.parse(contents),
              catch: () =>
                new WorkspaceError({
                  code: "invalid",
                  message: "The saved workspace is damaged. Its file has been preserved, and recent backups remain beside it."
                })
            })
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
          const payload = JSON.stringify(next)
          if (Buffer.byteLength(payload, "utf8") > maxBytes)
            return yield* new WorkspaceError({
              code: "invalid",
              message: `The workspace is too large to save (limit ${Math.round(maxBytes / 1024 / 1024)} MB). Remove large canvases before saving.`
            })
          const filePath = options.path
          if (filePath) {
            yield* Effect.tryPromise({
              try: async () => {
                await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
                const temporary = `${filePath}.${crypto.randomUUID()}.tmp`
                try {
                  await writeDurably(temporary, payload)
                  await rotateWorkspaceBackups(filePath)
                  await rename(temporary, filePath)
                } catch (error) {
                  await rm(temporary, { force: true }).catch(() => {})
                  throw error
                }
                await syncDirectory(dirname(filePath))
              },
              catch: () =>
                new WorkspaceError({ code: "storage", message: "Could not save the workspace. Your change has not been committed." })
            })
          }
          yield* Effect.sync(() => {
            for (const board of next.boards) revisions.set(board.id, board.revision)
          })
          yield* SubscriptionRef.set(state, next)
        })
        const create = Effect.fn("Workspace.create")(function* (input: CreateBoard) {
          const value = yield* decode(CreateBoard, input)
          const current = yield* SubscriptionRef.get(state)
          if (current.boards.length >= 200)
            return yield* new WorkspaceError({ code: "invalid", message: "A workspace can contain up to 200 canvases." })
          const id = value.id ?? crypto.randomUUID()
          if (current.boards.some(b => b.id === id))
            return yield* new WorkspaceError({ code: "conflict", message: "A canvas with this ID already exists." })
          const board: Board = {
            ...value,
            id,
            x: value.x ?? current.boards.reduce((right, b) => Math.max(right, b.x + b.width + 80), 0),
            y: value.y ?? 0,
            width: value.width ?? 760,
            height: value.height ?? 560,
            revision: (revisions.get(id) ?? -1) + 1
          }
          yield* commit({ ...current, boards: [...current.boards, board] })
          return board
        }, lock.withPermit)
        const update = Effect.fn("Workspace.update")(function* (id: string, patch: BoardPatch) {
          const { expectedRevision, ...fields } = yield* decode(BoardPatch, patch)
          const current = yield* SubscriptionRef.get(state)
          const existing = current.boards.find(b => b.id === id)
          if (!existing) return yield* new WorkspaceError({ code: "missing", message: "This canvas no longer exists." })
          if (expectedRevision !== undefined && expectedRevision !== existing.revision)
            return yield* new WorkspaceError({
              code: "conflict",
              message: "This canvas changed elsewhere. Your draft is still in the editor; copy it before reloading."
            })
          const board = yield* decode(Board, { ...existing, ...fields, revision: existing.revision + 1 })
          yield* commit({ ...current, boards: current.boards.map(b => (b.id === id ? board : b)) })
          return board
        }, lock.withPermit)
        const remove = Effect.fn("Workspace.remove")(function* (id: string, expectedRevision?: number) {
          const current = yield* SubscriptionRef.get(state)
          const existing = current.boards.find(b => b.id === id)
          if (!existing) return yield* new WorkspaceError({ code: "missing", message: "This canvas no longer exists." })
          if (expectedRevision !== undefined && expectedRevision !== existing.revision)
            return yield* new WorkspaceError({
              code: "conflict",
              message: "This canvas changed elsewhere. Review its latest content before deleting it."
            })
          yield* commit({ ...current, boards: current.boards.filter(b => b.id !== id) })
        }, lock.withPermit)
        const renameWorkspace = Effect.fn("Workspace.rename")(function* (name: string) {
          const current = yield* SubscriptionRef.get(state)
          yield* commit({ ...current, name })
        }, lock.withPermit)
        const collection = (workspace: Workspace): TokenCollection => ({ tokens: workspace.tokens, revision: workspace.tokensRevision })
        const checkTokenRevision = (workspace: Workspace, expected?: number) =>
          expected !== undefined && expected !== workspace.tokensRevision
            ? Effect.fail(
                new WorkspaceError({
                  code: "conflict",
                  message: "The token library changed elsewhere. Reload it before saving your draft."
                })
              )
            : Effect.void
        const upsertTokens = Effect.fn("Workspace.upsertTokens")(function* (input: UpsertTokens) {
          const value = yield* decode(UpsertTokens, input)
          const current = yield* SubscriptionRef.get(state)
          yield* checkTokenRevision(current, value.expectedRevision)
          if (new Set(value.tokens.map(token => token.name)).size !== value.tokens.length)
            return yield* new WorkspaceError({ code: "invalid", message: "Each token name must be unique." })
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
          if (!current.tokens.some(token => token.name === name))
            return yield* new WorkspaceError({ code: "missing", message: "This token no longer exists." })
          const boards = current.boards.filter(board => tokenReferences(board.html).includes(name))
          const aliases = current.tokens.filter(token => tokenReferences(token.value).includes(name))
          if (boards.length || aliases.length)
            return yield* new WorkspaceError({
              code: "conflict",
              message: `Token '${name}' is used by ${boards.length} canvas(es) and ${aliases.length} token(s). Replace those references before deleting it.`
            })
          const next: Workspace = {
            ...current,
            tokens: current.tokens.filter(token => token.name !== name),
            tokensRevision: current.tokensRevision + 1
          }
          yield* commit(next)
          return collection(next)
        }, lock.withPermit)
        return WorkspaceService.of({
          get: SubscriptionRef.get(state),
          changes: SubscriptionRef.changes(state),
          create,
          update,
          remove,
          rename: renameWorkspace,
          getTokens: SubscriptionRef.get(state).pipe(Effect.map(collection)),
          upsertTokens,
          deleteToken
        })
      })
    )
}
