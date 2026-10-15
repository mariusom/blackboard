import { Schema } from "effect"

export const TokenType = Schema.Literals(["color", "spacing", "font-size", "font-family", "font-weight", "radius", "number"])
export type TokenType = typeof TokenType.Type
export const TokenName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/), Schema.isMaxLength(80))
export const DesignToken = Schema.Struct({
  name: TokenName,
  type: TokenType,
  value: Schema.String.check(Schema.isBetweenLength(1, 240)),
  category: Schema.optionalKey(Schema.String.check(Schema.isBetweenLength(1, 60))),
  description: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(240))),
})
export interface DesignToken extends Schema.Schema.Type<typeof DesignToken> {}
export const TokenList = Schema.Array(DesignToken).check(Schema.isMaxLength(500))
export const TokenCollection = Schema.Struct({ tokens: TokenList, revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) })
export interface TokenCollection extends Schema.Schema.Type<typeof TokenCollection> {}
export const UpsertTokens = Schema.Struct({ tokens: TokenList, expectedRevision: Schema.optionalKey(TokenCollection.fields.revision) })
export interface UpsertTokens extends Schema.Schema.Type<typeof UpsertTokens> {}
export const DeleteToken = Schema.Struct({ name: TokenName, expectedRevision: Schema.optionalKey(TokenCollection.fields.revision) })

export const TOKEN_LABELS: Record<TokenType, string> = {
  color: "Colors", spacing: "Spacing", "font-size": "Font sizes", "font-family": "Font families",
  "font-weight": "Font weights", radius: "Radii", number: "Numbers",
}
/** Categories organize tokens independently of their CSS value type. */
export function groupTokens(tokens: readonly DesignToken[], query = ""): readonly { label: string; tokens: readonly DesignToken[] }[] {
  const groups = new Map<string, DesignToken[]>(Object.values(TOKEN_LABELS).map(label => [label, []]))
  const filter = query.trim().toLowerCase()
  for (const token of tokens) {
    const label = token.category?.trim() || TOKEN_LABELS[token.type]
    if (filter && !`${token.name} ${token.value} ${token.description ?? ""} ${label}`.toLowerCase().includes(filter)) continue
    const group = groups.get(label) ?? []
    group.push(token); groups.set(label, group)
  }
  return [...groups].filter(([, tokens]) => tokens.length).map(([label, tokens]) => ({ label, tokens }))
}
export const DEFAULT_TOKENS: readonly DesignToken[] = [
  { name: "color-surface", type: "color", value: "#f6f4ef", description: "Canvas background" },
  { name: "color-ink", type: "color", value: "#22261f", description: "Primary text" },
  { name: "color-muted", type: "color", value: "#6c7067", description: "Secondary text" },
  { name: "color-brand", type: "color", value: "#303d2b", description: "Primary actions" },
  { name: "color-on-brand", type: "color", value: "#ffffff" },
  { name: "color-art", type: "color", value: "#e3e7d8" },
  { name: "color-leaf", type: "color", value: "#899673" },
  { name: "color-leaf-dark", type: "color", value: "#536946" },
  { name: "font-body", type: "font-family", value: "-apple-system, BlinkMacSystemFont, sans-serif" },
  { name: "font-display", type: "font-family", value: "Georgia, serif" },
  { name: "size-body", type: "font-size", value: "13px" },
  { name: "size-display", type: "font-size", value: "61px" },
  { name: "size-display-mobile", type: "font-size", value: "48px" },
  { name: "space-sm", type: "spacing", value: "8px" },
  { name: "space-md", type: "spacing", value: "16px" },
  { name: "space-lg", type: "spacing", value: "24px" },
  { name: "radius-sm", type: "radius", value: "4px" },
]

export const tokenVariable = (name: string) => `var(--${name})`
const aliasName = (value: string) => /^var\(\s*--([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\s*\)$/.exec(value.trim())?.[1]
export const tokenReferences = (source: string): readonly string[] => [...new Set(Array.from(source.matchAll(/var\(\s*--([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\s*(?=[,)])/g), match => match[1]))]
const lengthTypes = new Set<TokenType>(["spacing", "radius", "font-size"])
const compatible = (a: TokenType, b: TokenType) => a === b || (lengthTypes.has(a) && lengthTypes.has(b))
function validLiteral(type: TokenType, value: string) {
  // Values cannot terminate a CSS declaration or introduce HTML, imports, or URLs.
  if (/[;{}<>\\@\x00-\x1f]/.test(value)) return false
  if (type === "color") return /^(?:#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8}|transparent|black|white)$/i.test(value)
  if (lengthTypes.has(type)) return /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%))$/.test(value)
  if (type === "font-weight") return /^(?:normal|bold|[1-9]\d{0,2}|1000)$/.test(value)
  if (type === "number") return /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && Number.isFinite(Number(value))
  return value.split(",").every(family => /^(?:[a-zA-Z_-][a-zA-Z0-9 _-]*|"[a-zA-Z0-9 _-]+"|'[a-zA-Z0-9 _-]+')$/.test(family.trim()))
}

/** Pure validation shared by persistence, API writes, previews, and export. */
export function tokenValidationError(tokens: readonly DesignToken[]): string | null {
  const names = new Map<string, DesignToken>()
  for (const token of tokens) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(token.name)) return `Use a lowercase CSS name such as color-brand.`
    if (names.has(token.name)) return `Token '${token.name}' is repeated.`
    names.set(token.name, token)
    if (!aliasName(token.value) && !validLiteral(token.type, token.value.trim())) return `Invalid ${token.type} value for '${token.name}'. Use a hex color, CSS length, font family/weight, number, or var(--token-name) of the same type.`
  }
  const visited = new Set<string>(), visiting = new Set<string>()
  const visit = (token: DesignToken): string | null => {
    if (visited.has(token.name)) return null
    if (visiting.has(token.name)) return `Token '${token.name}' contains a circular reference.`
    visiting.add(token.name)
    const reference = aliasName(token.value)
    if (reference) {
      const target = names.get(reference)
      if (!target) return `Token '${token.name}' refers to missing token '${reference}'.`
      if (!compatible(token.type, target.type)) return `Token '${token.name}' cannot reference a ${target.type} token.`
      const error = visit(target); if (error) return error
    }
    visiting.delete(token.name); visited.add(token.name); return null
  }
  for (const token of tokens) { const error = visit(token); if (error) return error }
  return null
}
export function tokensCSS(tokens: readonly DesignToken[]): string {
  const error = tokenValidationError(tokens); if (error) throw new Error(error)
  return tokens.length ? `:root {\n${tokens.map(token => `  --${token.name}: ${token.value.trim()};`).join("\n")}\n}` : ""
}
/** A draft is local until saved. Invalid drafts never reach CSS rendering. */
export function previewTokenDraft(tokens: readonly DesignToken[], token: DesignToken, creating: boolean): readonly DesignToken[] | undefined {
  if (creating && tokens.some(existing => existing.name === token.name)) return undefined
  const preview = [...tokens.filter(existing => existing.name !== token.name), token]
  return tokenValidationError(preview) ? undefined : preview
}
/** Include only the variables this document reads, plus transitive aliases. */
export function documentTokens(html: string, tokens: readonly DesignToken[]): readonly DesignToken[] {
  const required = new Set(tokenReferences(html))
  const byName = new Map(tokens.map(token => [token.name, token]))
  for (const name of required) {
    const token = byName.get(name)
    if (token) for (const reference of tokenReferences(token.value)) required.add(reference)
  }
  return tokens.filter(token => required.has(token.name))
}
export function resolvedTokenValue(token: DesignToken, tokens: readonly DesignToken[]): string {
  let value = token.value
  const seen = new Set<string>()
  while (aliasName(value)) {
    const name = aliasName(value)
    if (!name || seen.has(name)) return ""
    seen.add(name)
    const target = tokens.find(candidate => candidate.name === name)
    if (!target) return ""
    value = target.value
  }
  return value.trim()
}
