import { Schema } from "effect"
import { TokenList, documentTokens, tokensCSS, type DesignToken } from "./tokens"

const Coordinate = Schema.Finite.check(Schema.isBetween({ minimum: -100_000, maximum: 100_000 }))
const Dimension = Schema.Finite.check(Schema.isBetween({ minimum: 120, maximum: 6000 }))
const Name = Schema.String.check(Schema.isBetweenLength(1, 120))
const Html = Schema.String.check(Schema.isMaxLength(2_000_000))
export const Board = Schema.Struct({
  id: Schema.String,
  name: Name,
  x: Coordinate,
  y: Coordinate,
  width: Dimension,
  height: Dimension,
  html: Html,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
})
export interface Board extends Schema.Schema.Type<typeof Board> {}

/** A board without its HTML, for listings and search results where the full
 * source would dominate the payload. */
export const BoardSummary = Schema.Struct({
  id: Schema.String,
  name: Name,
  x: Coordinate,
  y: Coordinate,
  width: Dimension,
  height: Dimension,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
})
export interface BoardSummary extends Schema.Schema.Type<typeof BoardSummary> {}
export const summarizeBoard = (board: Board): BoardSummary => {
  const { html: _html, ...summary } = board
  return summary
}

export const CreateBoard = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  name: Name,
  html: Html,
  x: Schema.optionalKey(Coordinate),
  y: Schema.optionalKey(Coordinate),
  width: Schema.optionalKey(Dimension),
  height: Schema.optionalKey(Dimension)
})
export interface CreateBoard extends Schema.Schema.Type<typeof CreateBoard> {}

export const BoardPatch = Schema.Struct({
  name: Schema.optionalKey(Name),
  html: Schema.optionalKey(Html),
  x: Schema.optionalKey(Coordinate),
  y: Schema.optionalKey(Coordinate),
  width: Schema.optionalKey(Dimension),
  height: Schema.optionalKey(Dimension),
  expectedRevision: Schema.optionalKey(Schema.Int)
})
export interface BoardPatch extends Schema.Schema.Type<typeof BoardPatch> {}
export const DeleteBoard = Schema.Struct({ expectedRevision: Schema.Int })

export const LegacyWorkspace = Schema.Struct({
  version: Schema.Literal(1),
  name: Name,
  boards: Schema.Array(Board).check(Schema.isMaxLength(200))
})
export interface LegacyWorkspace extends Schema.Schema.Type<typeof LegacyWorkspace> {}
export const Workspace = Schema.Struct({
  version: Schema.Literal(2),
  name: Name,
  boards: LegacyWorkspace.fields.boards,
  tokens: TokenList,
  tokensRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
})
export interface Workspace extends Schema.Schema.Type<typeof Workspace> {}
export const SavedWorkspace = Schema.Union([LegacyWorkspace, Workspace])

declare const WorkspaceErrorBrand: unique symbol
export class WorkspaceError extends Schema.TaggedError<WorkspaceError, { readonly brand: typeof WorkspaceErrorBrand }>()("WorkspaceError", {
  message: Schema.String,
  code: Schema.Literals(["invalid", "missing", "conflict", "storage", "unavailable"])
}) {}

export interface Camera {
  readonly x: number
  readonly y: number
  readonly zoom: number
}
export const clampZoom = (zoom: number) => Math.max(0.1, Math.min(2, zoom))
export function zoomAt(camera: Camera, zoom: number, point: { x: number; y: number }): Camera {
  const next = clampZoom(zoom)
  return { x: point.x - ((point.x - camera.x) * next) / camera.zoom, y: point.y - ((point.y - camera.y) * next) / camera.zoom, zoom: next }
}
export function fitBoards(boards: readonly Board[], width: number, height: number): Camera {
  if (!boards.length) return { x: width / 2 - 320, y: height / 2 - 240, zoom: 1 }
  const left = Math.min(...boards.map(b => b.x))
  const top = Math.min(...boards.map(b => b.y))
  const right = Math.max(...boards.map(b => b.x + b.width))
  const bottom = Math.max(...boards.map(b => b.y + b.height))
  const zoom = clampZoom(Math.min(1, (width - 180) / (right - left), (height - 240) / (bottom - top)))
  return { x: (width - (right - left) * zoom) / 2 - left * zoom, y: (height - (bottom - top) * zoom) / 2 - top * zoom - 12, zoom }
}

/** Boards never inherit the app's origin or scripting authority. This policy also
 * prevents remote fonts/images, forms, and nested documents from sending content. */
export function previewDocument(html: string, tokens: readonly DesignToken[] = []): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'"><style>html,body{margin:0;min-height:100%;}*{box-sizing:border-box}body{font-family:system-ui,sans-serif}${tokensCSS(documentTokens(html, tokens))}</style></head><body>${html}</body></html>`
}

export function exportDocument(html: string, title: string, tokens: readonly DesignToken[] = []): string {
  const safeTitle = title.replace(
    /[&<>"']/g,
    character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character
  )
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style data-blackboard-tokens>${tokensCSS(tokens)}</style></head><body style="margin:0">${html}</body></html>`
}
