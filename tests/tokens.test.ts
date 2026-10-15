import { expect, it } from "bun:test"
import { Effect, ManagedRuntime, Schema } from "effect"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkspaceService } from "../src/workspace/WorkspaceService"
import { exportDocument, previewDocument } from "../src/workspace/model"
import { INITIAL_WORKSPACE, LEGACY_STUDIO_HTML, STUDIO_HTML } from "../src/workspace/templates"
import { DEFAULT_TOKENS, DesignToken, resolvedTokenValue, tokenReferences, tokenValidationError, tokensCSS } from "../src/workspace/tokens"

const brand: DesignToken = { name: "brand", type: "color", value: "#336699" }
const alias: DesignToken = { name: "action", type: "color", value: "var(--brand)" }
const empty = { version: 2 as const, name: "Test", boards: [], tokens: [], tokensRevision: 0 }
async function withFile(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "blackboard-tokens-test-"))
  try { await run(join(directory, "workspace.json")) } finally { await rm(directory, { recursive: true, force: true }) }
}

it("validates typed values, aliases, and safe CSS emission", () => {
  const tokens: readonly DesignToken[] = [...DEFAULT_TOKENS, brand, alias,
    { name: "gap", type: "spacing", value: "1.5rem" },
    { name: "corner", type: "radius", value: "var(--gap)" },
    { name: "weight", type: "font-weight", value: "500" },
    { name: "scale", type: "number", value: "1.2" }]
  expect(tokenValidationError(tokens)).toBeNull()
  expect(tokensCSS(tokens)).toContain("--action: var(--brand);")
  expect(resolvedTokenValue(alias, tokens)).toBe(brand.value)
  expect(tokenReferences("color:var(--brand,#fff);gap:var( --gap );border:var(--brand)")).toEqual(["brand", "gap"])
  expect(tokenValidationError([alias])).toContain("missing")
  expect(tokenValidationError([brand, { ...alias, type: "spacing" }])).toContain("cannot reference")
  expect(tokenValidationError([{ ...brand, value: "var(--action)" }, alias])).toContain("circular")
  expect(tokenValidationError([brand, brand])).toContain("repeated")
})

it("rejects CSS and HTML injection and values incompatible with their types", () => {
  for (const value of ["red; background:url(https://example.com)", "</style><script>alert(1)</script>", "url(https://example.com)", "#fff!important", "var(--brand, #fff)"]) {
    expect(() => tokensCSS([{ ...brand, value }])).toThrow()
  }
  expect(() => Schema.decodeSync(DesignToken)({ ...brand, name: "x; color:red" })).toThrow()
  expect(tokenValidationError([{ ...brand, type: "font-family", value: "system-ui, url(x)" }])).not.toBeNull()
  expect(tokenValidationError([{ ...brand, type: "spacing", value: "-1px" }])).not.toBeNull()
  expect(tokenValidationError([{ ...brand, type: "font-weight", value: "1001" }])).not.toBeNull()
})

it("persists merged tokens with revisions and rejects concurrent stale edits atomically", () => withFile(async path => {
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer({ path, initial: empty }))
  try {
    const service = await runtime.runPromise(WorkspaceService)
    await runtime.runPromise(service.upsertTokens({ tokens: [brand, alias], expectedRevision: 0 }))
    const outcomes = await Promise.all(["#112233", "#445566"].map(value => runtime.runPromise(Effect.result(service.upsertTokens({ tokens: [{ ...brand, value }], expectedRevision: 1 })))))
    expect(outcomes.filter(result => result._tag === "Success")).toHaveLength(1)
    expect(outcomes.filter(result => result._tag === "Failure")).toHaveLength(1)
    const saved = await runtime.runPromise(service.getTokens)
    expect(saved.revision).toBe(2)
    expect(saved.tokens.find(token => token.name === "action")).toEqual(alias)
    const invalid = await runtime.runPromise(Effect.result(service.upsertTokens({ tokens: [{ ...brand, value: "var(--action)" }], expectedRevision: 2 })))
    expect(invalid._tag).toBe("Failure")
    expect(await runtime.runPromise(service.getTokens)).toEqual(saved)
    const duplicate = await runtime.runPromise(Effect.result(service.upsertTokens({ tokens: [brand, brand] })))
    expect(duplicate._tag).toBe("Failure")
    expect(JSON.parse(await readFile(path, "utf8")).tokensRevision).toBe(2)
  } finally { await runtime.dispose() }
  const reopened = ManagedRuntime.make(WorkspaceService.makeLayer({ path }))
  try { expect((await reopened.runPromise(Effect.flatMap(WorkspaceService, service => service.getTokens))).revision).toBe(2) }
  finally { await reopened.dispose() }
}))

it("guards token deletion for canvas usage and aliases while allowing unused tokens", async () => {
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer({ initial: empty }))
  try {
    const service = await runtime.runPromise(WorkspaceService)
    await runtime.runPromise(service.upsertTokens({ tokens: [brand, alias] }))
    expect((await runtime.runPromise(Effect.result(service.deleteToken("brand"))))._tag).toBe("Failure")
    const board = await runtime.runPromise(service.create({ name: "Linked", html: '<div style="color:var(--action, #fff)">Hello</div>' }))
    expect((await runtime.runPromise(Effect.result(service.deleteToken("action"))))._tag).toBe("Failure")
    await runtime.runPromise(service.remove(board.id))
    await runtime.runPromise(service.deleteToken("action", 1))
    expect((await runtime.runPromise(Effect.result(service.deleteToken("brand", 1))))._tag).toBe("Failure")
    expect((await runtime.runPromise(service.deleteToken("brand", 2))).tokens).toEqual([])
  } finally { await runtime.dispose() }
})

it("migrates untouched starter canvases while preserving custom HTML and geometry", () => withFile(async path => {
  const starter = INITIAL_WORKSPACE.boards[0]
  if (!starter) throw new Error("Expected starter canvas")
  const legacy = { version: 1, name: "Existing work", boards: [
    { ...starter, html: LEGACY_STUDIO_HTML, revision: 8 },
    { ...starter, id: "custom", x: -120, html: "<h1>Keep my design</h1>", revision: 4 },
  ] }
  await writeFile(path, JSON.stringify(legacy))
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer({ path }))
  try {
    const service = await runtime.runPromise(WorkspaceService)
    const migrated = await runtime.runPromise(service.get)
    expect(migrated.version).toBe(2)
    expect(migrated.tokens).toEqual(DEFAULT_TOKENS)
    expect(migrated.boards[0]?.html).toBe(STUDIO_HTML)
    expect(migrated.boards[0]?.revision).toBe(9)
    expect(migrated.boards[1]).toEqual(legacy.boards[1])
    await runtime.runPromise(service.rename("Saved migration"))
    expect(JSON.parse(await readFile(path, "utf8")).version).toBe(2)
  } finally { await runtime.dispose() }
}))

it("preserves an invalid saved token library without overwriting the workspace", () => withFile(async path => {
  const contents = JSON.stringify({ ...empty, tokens: [alias] })
  await writeFile(path, contents)
  const runtime = ManagedRuntime.make(WorkspaceService.makeLayer({ path }))
  try { await expect(runtime.runPromise(WorkspaceService)).rejects.toThrow("missing token") }
  finally { await runtime.dispose() }
  expect(await readFile(path, "utf8")).toBe(contents)
}))

it("embeds shared values and aliases in both sandboxed previews and standalone exports", () => {
  const source = '<style>h1{color:var(--action)}</style><h1>Shared design</h1>'
  const preview = previewDocument(source, [brand, alias])
  const exported = exportDocument(source, "A </title> & B", [brand, alias])
  for (const html of [preview, exported]) {
    expect(html).toContain("--brand: #336699;")
    expect(html).toContain("--action: var(--brand);")
    expect(html).toContain(source)
  }
  expect(preview).toContain("default-src 'none'")
  expect(exported).toContain("A &lt;/title&gt; &amp; B")
  expect(exported).toContain("data-blackboard-tokens")
})
