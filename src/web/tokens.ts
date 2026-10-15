import type { Workspace } from "../workspace/model"
import { DesignToken, TOKEN_LABELS, TokenCollection, TokenType, resolvedTokenValue, tokenReferences, tokenVariable, tokensCSS } from "../workspace/tokens"
import { Schema } from "effect"

const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id); if (!node) throw new Error(`Missing token control: ${id}`)
  return node as T
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c))
export function createTokenPanel(options: {
  readonly workspace: () => Workspace | undefined
  readonly request: (path: string, body: unknown) => Promise<unknown>
  readonly refresh: () => Promise<void>
  readonly copy: (text: string) => Promise<void>
  readonly notify: (message: string) => void
}) {
  const dialog = get<HTMLDialogElement>("tokens-dialog")
  const form = get<HTMLFormElement>("token-form")
  const name = get<HTMLInputElement>("token-name")
  const type = get<HTMLSelectElement>("token-type")
  const value = get<HTMLInputElement>("token-value")
  const description = get<HTMLTextAreaElement>("token-description")
  let draft: { name: string | null; revision: number; dirty: boolean } | null = null
  let saving = false
  const error = (message: string) => { get("token-error").textContent = message; get("token-error").hidden = !message }
  const usage = (tokenName: string, workspace: Workspace) => ({
    boards: workspace.boards.filter(board => tokenReferences(board.html).includes(tokenName)).length,
    aliases: workspace.tokens.filter(token => tokenReferences(token.value).includes(tokenName)).length,
  })
  function controls() {
    const workspace = options.workspace(); if (!workspace) return
    const used = usage(draft?.name ?? "", workspace)
    get<HTMLButtonElement>("token-save").disabled = saving || !draft?.dirty
    get<HTMLButtonElement>("token-delete").disabled = saving || !draft?.name || Boolean(used.boards || used.aliases)
    get("token-usage").textContent = draft?.name ? `${used.boards} canvas${used.boards === 1 ? "" : "es"}${used.aliases ? ` · ${used.aliases} alias${used.aliases === 1 ? "" : "es"}` : ""} use this token.` : "Shared across this workspace."
    get("token-reference").textContent = tokenVariable(name.value.trim() || "token-name")
    const picker = get<HTMLInputElement>("token-color")
    picker.hidden = type.value !== "color" || !/^#[0-9a-f]{6}$/i.test(value.value)
    if (!picker.hidden) picker.value = value.value
  }
  function load(token?: DesignToken) {
    const workspace = options.workspace(); if (!workspace) return
    draft = { name: token?.name ?? null, revision: workspace.tokensRevision, dirty: false }
    name.value = token?.name ?? ""; name.readOnly = Boolean(token)
    type.value = token?.type ?? "color"; value.value = token?.value ?? "#303d2b"; description.value = token?.description ?? ""
    get("token-form-title").textContent = token ? "Edit token" : "New token"
    error(""); controls()
  }
  function mayDiscard() { return !saving && (!draft?.dirty || window.confirm("Discard your unsaved token draft?")) }
  function render() {
    const workspace = options.workspace(); if (!workspace) return
    get("token-count").textContent = `${workspace.tokens.length} shared values`
    const list = get("token-list"); list.replaceChildren()
    for (const [kind, label] of Object.entries(TOKEN_LABELS)) {
      const tokens = workspace.tokens.filter(token => token.type === kind); if (!tokens.length) continue
      const heading = document.createElement("h3"); heading.textContent = label; list.append(heading)
      for (const token of tokens) {
        const button = document.createElement("button"); button.className = "token-row"; button.type = "button"
        button.classList.toggle("selected", token.name === draft?.name)
        button.setAttribute("aria-label", `${token.name}, ${token.value}`)
        button.innerHTML = `<span class="token-swatch">${token.type === "color" ? "" : token.type.startsWith("font") ? "Aa" : "↔"}</span><span class="token-row-text"><strong>${escape(token.name)}</strong><span>${escape(token.value)}</span></span>`
        if (token.type === "color") { const swatch = button.querySelector<HTMLElement>(".token-swatch"); if (swatch) swatch.style.backgroundColor = resolvedTokenValue(token, workspace.tokens) }
        button.addEventListener("click", () => { if (mayDiscard()) { load(token); render() } })
        list.append(button)
      }
    }
    if (!workspace.tokens.length) { const empty = document.createElement("p"); empty.className = "token-empty"; empty.textContent = "Create a value to reuse across your canvases."; list.append(empty) }
    controls()
  }
  function update() {
    if (!dialog.open) return
    const workspace = options.workspace(); if (!workspace) return
    if (draft && !draft.dirty) load(workspace.tokens.find(token => token.name === draft?.name))
    render()
  }
  function close() { if (mayDiscard()) { draft = null; dialog.close() } }
  async function save() {
    const workspace = options.workspace(); if (!workspace || !draft || saving) return
    if (!form.reportValidity()) return
    saving = true; controls(); error("")
    try {
      const token = Schema.decodeUnknownSync(DesignToken)({ name: name.value.trim(), type: type.value, value: value.value.trim(), ...(description.value.trim() ? { description: description.value.trim() } : {}) })
      if (!draft.name && workspace.tokens.some(existing => existing.name === token.name)) throw new Error("A token with that name already exists. Select it to edit its value.")
      const saved = Schema.decodeUnknownSync(TokenCollection)(await options.request("tokens", { tokens: [token], expectedRevision: draft.revision }))
      draft.dirty = false; await options.refresh(); load(saved.tokens.find(candidate => candidate.name === token.name)); render(); options.notify("Token saved. Linked canvases are updated.")
    } catch (cause) { error(cause instanceof Error ? cause.message : "Could not save the token.") }
    finally { saving = false; controls() }
  }
  form.addEventListener("submit", event => { event.preventDefault(); void save() })
  form.addEventListener("input", () => { if (draft) draft.dirty = true; controls() })
  dialog.addEventListener("keydown", event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void save() } })
  dialog.addEventListener("cancel", event => { event.preventDefault(); close() })
  get("tokens-button").addEventListener("click", () => {
    const workspace = options.workspace(); if (!workspace) return
    load(workspace.tokens[0]); render(); dialog.showModal()
  })
  get("close-tokens").addEventListener("click", close)
  get("token-add").addEventListener("click", () => { if (mayDiscard()) { load(); render(); name.focus() } })
  get("token-copy-reference").addEventListener("click", () => { void options.copy(tokenVariable(name.value.trim() || "token-name")).then(() => options.notify("CSS reference copied")).catch(cause => error(String(cause))) })
  get("token-copy-css").addEventListener("click", () => { const workspace = options.workspace(); if (workspace) void options.copy(tokensCSS(workspace.tokens)).then(() => options.notify("Token CSS copied")).catch(cause => error(String(cause))) })
  get("token-color").addEventListener("input", () => { value.value = get<HTMLInputElement>("token-color").value; if (draft) draft.dirty = true; controls() })
  type.addEventListener("change", () => {
    const examples: Record<TokenType, string> = { color: "#303d2b", spacing: "16px", "font-size": "16px", "font-family": "Georgia, serif", "font-weight": "500", radius: "8px", number: "1.5" }
    value.placeholder = examples[Schema.decodeUnknownSync(TokenType)(type.value)]; controls()
  })
  get("token-delete").addEventListener("click", () => {
    if (!draft?.name || saving || !mayDiscard()) return
    const removed = draft.name, revision = draft.revision
    saving = true; controls()
    void options.request("tokens/delete", { name: removed, expectedRevision: revision }).then(async () => {
      draft = null; await options.refresh(); load(); render(); options.notify(`Token '${removed}' deleted`)
    }).catch(cause => error(cause instanceof Error ? cause.message : "Could not delete the token.")).finally(() => { saving = false; controls() })
  })
  return { update, hasUnsavedChanges: () => Boolean(draft?.dirty) }
}
