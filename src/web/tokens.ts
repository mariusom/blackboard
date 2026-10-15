import type { Workspace } from '../workspace/model';
import {
  DesignToken,
  TOKEN_LABELS,
  TokenCollection,
  TokenType,
  groupTokens,
  resolvedTokenValue,
  tokenReferences,
  tokenVariable,
  previewTokenDraft,
  tokensCSS,
} from '../workspace/tokens';
import { Schema } from 'effect';

const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing token control: ${id}`);
  return node as T;
};
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const EXAMPLES: Record<TokenType, string> = {
  color: '#303d2b',
  spacing: '16px',
  'font-size': '16px',
  'font-family': 'Georgia, serif',
  'font-weight': '500',
  radius: '8px',
  number: '1.5',
};

export interface TokenPanelOptions {
  readonly workspace: () => Workspace | undefined;
  readonly request: (path: string, body: unknown) => Promise<unknown>;
  readonly refresh: () => Promise<void>;
  readonly copy: (text: string) => Promise<void>;
  readonly notify: (message: string) => void;
  readonly onInspect: () => boolean;
  readonly onClose: () => void;
  readonly onLibrary: () => void;
  readonly onSelectBoard: (id: string) => void;
  readonly onPreview: (tokens?: readonly DesignToken[]) => void;
}

interface TokenDraft {
  name: string | null;
  revision: number;
  dirty: boolean;
}

interface TokenPanelContext {
  readonly options: TokenPanelOptions;
  readonly panel: HTMLElement;
  readonly search: HTMLInputElement;
  readonly form: HTMLFormElement;
  readonly name: HTMLInputElement;
  readonly type: HTMLSelectElement;
  readonly value: HTMLInputElement;
  readonly category: HTMLInputElement;
  readonly description: HTMLTextAreaElement;
  readonly collapsed: Set<string>;
  draft: TokenDraft | null;
  saving: boolean;
  previewTimer: ReturnType<typeof setTimeout> | undefined;
}

interface TokenGroupView {
  readonly label: string;
  readonly tokens: readonly DesignToken[];
  readonly workspace: Workspace;
  readonly list: HTMLElement;
}

interface TokenRowView {
  readonly group: HTMLElement;
  readonly token: DesignToken;
  readonly tokens: readonly DesignToken[];
}

const usage = (tokenName: string, workspace: Workspace) => ({
  boards: workspace.boards.filter((board) => tokenReferences(board.html).includes(tokenName)).length,
  aliases: workspace.tokens.filter((token) => tokenReferences(token.value).includes(tokenName)).length,
});

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 'es'}`;

const mayDiscard = (ctx: TokenPanelContext) =>
  !ctx.saving && (!ctx.draft?.dirty || window.confirm('Discard your unsaved token draft?'));

function error(ctx: TokenPanelContext, message: string) {
  get('token-error').textContent = message;
  get('token-error').hidden = !message;
}

function renderDraftState(ctx: TokenPanelContext) {
  const dirty = Boolean(ctx.draft?.dirty);
  get('tokens-button').classList.toggle('has-draft', dirty);
  const state = get('token-draft-state');
  state.textContent = dirty ? 'Previewing an unsaved change' : 'All changes saved';
  state.classList.toggle('dirty', dirty);
  get<HTMLButtonElement>('token-discard').disabled = ctx.saving || !dirty;
}

function renderUsageLinks(ctx: TokenPanelContext, workspace: Workspace) {
  const usageList = get('token-usage-list');
  usageList.replaceChildren();
  const used = workspace.boards.filter((board) => tokenReferences(board.html).includes(ctx.draft?.name ?? ''));
  for (const board of used) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${board.name} ↗`;
    button.addEventListener('click', () => ctx.options.onSelectBoard(board.id));
    usageList.append(button);
  }
}

function renderUsage(ctx: TokenPanelContext, workspace: Workspace) {
  const used = usage(ctx.draft?.name ?? '', workspace);
  get<HTMLButtonElement>('token-save').disabled = ctx.saving || !ctx.draft?.dirty;
  get<HTMLButtonElement>('token-delete').disabled =
    ctx.saving || !ctx.draft?.name || Boolean(used.boards || used.aliases);
  get('token-usage').textContent = ctx.draft?.name
    ? `${plural(used.boards, 'canvas')}${used.aliases ? ` · ${plural(used.aliases, 'alias')}` : ''} use this token.`
    : 'Shared across this workspace.';
}

function renderReference(ctx: TokenPanelContext) {
  get('token-reference').textContent = tokenVariable(ctx.name.value.trim() || 'token-name');
  const picker = get<HTMLInputElement>('token-color');
  picker.hidden = ctx.type.value !== 'color' || !/^#[0-9a-f]{6}$/i.test(ctx.value.value);
  if (!picker.hidden) picker.value = ctx.value.value;
}

function controls(ctx: TokenPanelContext) {
  const workspace = ctx.options.workspace();
  if (!workspace) return;
  renderDraftState(ctx);
  renderUsageLinks(ctx, workspace);
  renderUsage(ctx, workspace);
  renderReference(ctx);
}

function renderSuggestions(ctx: TokenPanelContext, workspace: Workspace) {
  const suggestions = get<HTMLDataListElement>('token-categories');
  suggestions.replaceChildren();
  for (const label of new Set(workspace.tokens.flatMap((token) => (token.category ? [token.category] : [])))) {
    const option = document.createElement('option');
    option.value = label;
    suggestions.append(option);
  }
}

function renderGroupAdd(ctx: TokenPanelContext, label: string, add: HTMLButtonElement) {
  add.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!mayDiscard(ctx)) return;
    load(ctx);
    const kind = Object.entries(TOKEN_LABELS).find(([, name]) => name === label)?.[0];
    if (kind) {
      const tokenType = Schema.decodeUnknownSync(TokenType)(kind);
      ctx.type.value = tokenType;
      ctx.value.value = EXAMPLES[tokenType];
    } else ctx.category.value = label;
    showDetail(ctx, true);
    render(ctx);
    ctx.name.focus();
  });
}

function renderTokenRow(ctx: TokenPanelContext, view: TokenRowView) {
  const { group, token, tokens } = view;
  const button = document.createElement('button');
  button.className = 'token-row';
  button.type = 'button';
  button.classList.toggle('selected', token.name === ctx.draft?.name);
  button.setAttribute('aria-label', `${token.name}, ${token.value}`);
  button.innerHTML = `<span class="token-swatch">${token.type === 'color' ? '' : token.type.startsWith('font') ? 'Aa' : '↔'}</span><span class="token-row-text"><strong>${escapeHtml(token.name)}</strong><span>${escapeHtml(token.value)}</span></span>`;
  if (token.type === 'color') {
    const swatch = button.querySelector<HTMLElement>('.token-swatch');
    if (swatch) swatch.style.backgroundColor = resolvedTokenValue(token, tokens);
  }
  button.addEventListener('click', () => {
    if (mayDiscard(ctx)) {
      load(ctx, token);
      showDetail(ctx, true);
      render(ctx);
      ctx.value.focus();
    }
  });
  group.append(button);
}

function renderGroup(ctx: TokenPanelContext, view: TokenGroupView) {
  const { label, tokens, workspace, list } = view;
  const group = document.createElement('details');
  group.className = 'token-group';
  group.open = Boolean(ctx.search.value.trim()) || !ctx.collapsed.has(label);
  const summary = document.createElement('summary');
  const title = document.createElement('span');
  title.textContent = label;
  const count = document.createElement('span');
  count.className = 'token-group-count';
  count.textContent = String(tokens.length);
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'token-group-add';
  add.textContent = '+';
  add.setAttribute('aria-label', `Add token to ${label}`);
  renderGroupAdd(ctx, label, add);
  summary.append(title, count, add);
  group.append(summary);
  group.addEventListener('toggle', () => {
    if (group.isConnected && !ctx.search.value.trim()) {
      if (group.open) ctx.collapsed.delete(label);
      else ctx.collapsed.add(label);
    }
  });
  list.append(group);
  for (const token of tokens) renderTokenRow(ctx, { group, token, tokens: workspace.tokens });
}

function renderEmptyState(ctx: TokenPanelContext, list: HTMLElement) {
  const empty = document.createElement('p');
  empty.className = 'token-empty';
  empty.textContent = ctx.search.value ? 'No matching tokens.' : 'Create a value to reuse across your canvases.';
  list.append(empty);
}

function render(ctx: TokenPanelContext) {
  const workspace = ctx.options.workspace();
  if (!workspace) return;
  get('token-count').textContent = `${workspace.tokens.length} shared values`;
  const list = get('token-list');
  list.replaceChildren();
  renderSuggestions(ctx, workspace);
  for (const { label, tokens } of groupTokens(workspace.tokens, ctx.search.value))
    renderGroup(ctx, { label, tokens, workspace, list });
  if (!list.childElementCount) renderEmptyState(ctx, list);
  controls(ctx);
}

function load(ctx: TokenPanelContext, token?: DesignToken) {
  clearTimeout(ctx.previewTimer);
  const workspace = ctx.options.workspace();
  if (!workspace) return;
  ctx.draft = { name: token?.name ?? null, revision: workspace.tokensRevision, dirty: false };
  ctx.category.value = token?.category ?? '';
  ctx.name.value = token?.name ?? '';
  ctx.name.readOnly = Boolean(token);
  ctx.type.value = token?.type ?? 'color';
  ctx.value.value = token?.value ?? '#303d2b';
  ctx.description.value = token?.description ?? '';
  get('token-form-title').textContent = token ? 'Edit token' : 'New token';
  ctx.options.onPreview();
  error(ctx, '');
  controls(ctx);
}

function showDetail(ctx: TokenPanelContext, detail: boolean) {
  if (detail && !ctx.options.onInspect()) return;
  ctx.form.hidden = !detail;
  if (!detail) ctx.options.onClose();
}

function back(ctx: TokenPanelContext) {
  ctx.form.hidden = true;
  ctx.options.onClose();
}

function revealDraft(ctx: TokenPanelContext) {
  ctx.options.onLibrary();
  showDetail(ctx, true);
  render(ctx);
  ctx.value.focus();
}

function draftToken(ctx: TokenPanelContext) {
  return Schema.decodeUnknownSync(DesignToken)({
    name: ctx.name.value.trim(),
    type: ctx.type.value,
    value: ctx.value.value.trim(),
    ...(ctx.category.value.trim() ? { category: ctx.category.value.trim() } : {}),
    ...(ctx.description.value.trim() ? { description: ctx.description.value.trim() } : {}),
  });
}

function previewDraft(ctx: TokenPanelContext) {
  const workspace = ctx.options.workspace();
  if (!workspace || !ctx.draft?.dirty) return;
  try {
    const token = draftToken(ctx);
    const preview = previewTokenDraft(workspace.tokens, token, !ctx.draft.name);
    if (preview) ctx.options.onPreview(preview);
  } catch {
    /* Keep the last valid draft visible while a value is incomplete. */
  }
}

function update(ctx: TokenPanelContext) {
  const workspace = ctx.options.workspace();
  if (!workspace) return;
  if (ctx.draft?.dirty) previewDraft(ctx);
  if (ctx.panel.hidden && get('token-inspector').hidden) return;
  if (ctx.draft && !ctx.draft.dirty) {
    const current = workspace.tokens.find((token) => token.name === ctx.draft?.name);
    if (ctx.draft.name && !current) {
      ctx.draft = null;
      showDetail(ctx, false);
    } else load(ctx, current);
  }
  render(ctx);
}

function selectToken(ctx: TokenPanelContext, tokenName: string) {
  const token = ctx.options.workspace()?.tokens.find((token) => token.name === tokenName);
  if (!token) {
    ctx.options.notify(`Token '${tokenName}' is not in the shared library.`);
    return;
  }
  if (!mayDiscard(ctx)) return;
  load(ctx, token);
  ctx.options.onLibrary();
  showDetail(ctx, true);
  render(ctx);
  ctx.value.focus();
}

async function save(ctx: TokenPanelContext) {
  const workspace = ctx.options.workspace();
  if (!workspace || !ctx.draft || ctx.saving) return;
  if (!ctx.form.reportValidity()) return;
  ctx.saving = true;
  controls(ctx);
  error(ctx, '');
  try {
    const token = draftToken(ctx);
    if (!ctx.draft.name && workspace.tokens.some((existing) => existing.name === token.name))
      throw new Error('A token with that name already exists. Select it to edit its value.');
    const saved = Schema.decodeUnknownSync(TokenCollection)(
      await ctx.options.request('tokens', { tokens: [token], expectedRevision: ctx.draft.revision }),
    );
    ctx.draft.dirty = false;
    await ctx.options.refresh();
    load(
      ctx,
      saved.tokens.find((candidate) => candidate.name === token.name),
    );
    render(ctx);
    ctx.options.notify('Token saved. Linked canvases are updated.');
  } catch (cause) {
    error(ctx, cause instanceof Error ? cause.message : 'Could not save the token.');
  } finally {
    ctx.saving = false;
    controls(ctx);
  }
}

async function deleteDraft(ctx: TokenPanelContext) {
  if (!ctx.draft?.name || ctx.saving || !mayDiscard(ctx)) return;
  const removed = ctx.draft.name;
  const revision = ctx.draft.revision;
  ctx.saving = true;
  controls(ctx);
  try {
    await ctx.options.request('tokens/delete', { name: removed, expectedRevision: revision });
    ctx.draft = null;
    ctx.options.onPreview();
    await ctx.options.refresh();
    showDetail(ctx, false);
    render(ctx);
    ctx.options.notify(`Token '${removed}' deleted`);
  } catch (cause) {
    error(ctx, cause instanceof Error ? cause.message : 'Could not delete the token.');
  } finally {
    ctx.saving = false;
    controls(ctx);
  }
}

function discardDraft(ctx: TokenPanelContext) {
  if (ctx.saving) return;
  const token = ctx.options.workspace()?.tokens.find((candidate) => candidate.name === ctx.draft?.name);
  load(ctx, token);
  render(ctx);
  ctx.options.notify('Token draft discarded');
}

function addToken(ctx: TokenPanelContext) {
  if (!mayDiscard(ctx)) return;
  load(ctx);
  showDetail(ctx, true);
  render(ctx);
  ctx.name.focus();
}

function addCategory(ctx: TokenPanelContext) {
  if (!mayDiscard(ctx)) return;
  load(ctx);
  showDetail(ctx, true);
  render(ctx);
  ctx.category.focus();
}

function openLibrary(ctx: TokenPanelContext) {
  ctx.options.onLibrary();
  update(ctx);
  if (ctx.draft) {
    showDetail(ctx, true);
    ctx.value.focus();
  } else ctx.search.focus();
}

function copyReference(ctx: TokenPanelContext) {
  void ctx.options
    .copy(tokenVariable(ctx.name.value.trim() || 'token-name'))
    .then(() => ctx.options.notify('CSS reference copied'))
    .catch((cause) => error(ctx, String(cause)));
}

function copyCss(ctx: TokenPanelContext) {
  const workspace = ctx.options.workspace();
  if (!workspace) return;
  void ctx.options
    .copy(tokensCSS(workspace.tokens))
    .then(() => ctx.options.notify('Token CSS copied'))
    .catch((cause) => error(ctx, String(cause)));
}

function syncColorInput(ctx: TokenPanelContext) {
  ctx.value.value = get<HTMLInputElement>('token-color').value;
  if (ctx.draft) ctx.draft.dirty = true;
  clearTimeout(ctx.previewTimer);
  ctx.previewTimer = setTimeout(() => previewDraft(ctx), 80);
  controls(ctx);
}

function onTypeChange(ctx: TokenPanelContext) {
  const tokenType = Schema.decodeUnknownSync(TokenType)(ctx.type.value);
  ctx.value.placeholder = EXAMPLES[tokenType];
  if (!ctx.draft?.name && Object.values(EXAMPLES).includes(ctx.value.value)) ctx.value.value = EXAMPLES[tokenType];
  previewDraft(ctx);
  controls(ctx);
}

function wireEvents(ctx: TokenPanelContext) {
  ctx.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save(ctx);
  });
  ctx.form.addEventListener('input', () => {
    if (ctx.draft) ctx.draft.dirty = true;
    clearTimeout(ctx.previewTimer);
    ctx.previewTimer = setTimeout(() => previewDraft(ctx), 120);
    controls(ctx);
  });
  const keys = (event: KeyboardEvent) => {
    // Canvas shortcuts must never act on a focused token control.
    event.stopPropagation();
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !ctx.form.hidden) {
      event.preventDefault();
      void save(ctx);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      back(ctx);
    }
  };
  ctx.panel.addEventListener('keydown', keys);
  ctx.form.addEventListener('keydown', keys);
  get('tokens-button').addEventListener('click', () => openLibrary(ctx));
  get('token-back').addEventListener('click', () => back(ctx));
  get('token-discard').addEventListener('click', () => discardDraft(ctx));
  get('token-add-category').addEventListener('click', () => addCategory(ctx));
  ctx.search.addEventListener('input', () => render(ctx));
  get('token-add').addEventListener('click', () => addToken(ctx));
  get('token-copy-reference').addEventListener('click', () => copyReference(ctx));
  get('token-copy-css').addEventListener('click', () => copyCss(ctx));
  get('token-color').addEventListener('input', () => syncColorInput(ctx));
  ctx.type.addEventListener('change', () => onTypeChange(ctx));
  get('token-delete').addEventListener('click', () => void deleteDraft(ctx));
}

export function createTokenPanel(options: TokenPanelOptions) {
  const ctx: TokenPanelContext = {
    options,
    panel: get('tokens-sidebar'),
    search: get<HTMLInputElement>('token-search'),
    form: get<HTMLFormElement>('token-form'),
    name: get<HTMLInputElement>('token-name'),
    type: get<HTMLSelectElement>('token-type'),
    value: get<HTMLInputElement>('token-value'),
    category: get<HTMLInputElement>('token-category'),
    description: get<HTMLTextAreaElement>('token-description'),
    collapsed: new Set(),
    draft: null,
    saving: false,
    previewTimer: undefined,
  };
  wireEvents(ctx);
  return {
    update: () => update(ctx),
    selectToken: (tokenName: string) => selectToken(ctx, tokenName),
    revealDraft: () => revealDraft(ctx),
    hasUnsavedChanges: () => Boolean(ctx.draft?.dirty),
  };
}
