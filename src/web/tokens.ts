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
export function createTokenPanel(options: {
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
}) {
  const panel = get('tokens-sidebar');
  const search = get<HTMLInputElement>('token-search');
  const form = get<HTMLFormElement>('token-form');
  const name = get<HTMLInputElement>('token-name');
  const type = get<HTMLSelectElement>('token-type');
  const value = get<HTMLInputElement>('token-value');
  const category = get<HTMLInputElement>('token-category');
  const collapsed = new Set<string>();
  const description = get<HTMLTextAreaElement>('token-description');
  let draft: { name: string | null; revision: number; dirty: boolean } | null = null;
  let saving = false;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  const error = (message: string) => {
    get('token-error').textContent = message;
    get('token-error').hidden = !message;
  };
  const usage = (tokenName: string, workspace: Workspace) => ({
    boards: workspace.boards.filter((board) => tokenReferences(board.html).includes(tokenName)).length,
    aliases: workspace.tokens.filter((token) => tokenReferences(token.value).includes(tokenName)).length,
  });
  function controls() {
    const workspace = options.workspace();
    if (!workspace) return;
    get('tokens-button').classList.toggle('has-draft', Boolean(draft?.dirty));
    get('token-draft-state').textContent = draft?.dirty ? 'Previewing an unsaved change' : 'All changes saved';
    get('token-draft-state').classList.toggle('dirty', Boolean(draft?.dirty));
    get<HTMLButtonElement>('token-discard').disabled = saving || !draft?.dirty;
    const used = usage(draft?.name ?? '', workspace);
    const usageList = get('token-usage-list');
    usageList.replaceChildren();
    for (const board of workspace.boards.filter((board) => tokenReferences(board.html).includes(draft?.name ?? ''))) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${board.name} ↗`;
      button.addEventListener('click', () => options.onSelectBoard(board.id));
      usageList.append(button);
    }
    get<HTMLButtonElement>('token-save').disabled = saving || !draft?.dirty;
    get<HTMLButtonElement>('token-delete').disabled = saving || !draft?.name || Boolean(used.boards || used.aliases);
    get('token-usage').textContent = draft?.name
      ? `${used.boards} canvas${used.boards === 1 ? '' : 'es'}${used.aliases ? ` · ${used.aliases} alias${used.aliases === 1 ? '' : 'es'}` : ''} use this token.`
      : 'Shared across this workspace.';
    get('token-reference').textContent = tokenVariable(name.value.trim() || 'token-name');
    const picker = get<HTMLInputElement>('token-color');
    picker.hidden = type.value !== 'color' || !/^#[0-9a-f]{6}$/i.test(value.value);
    if (!picker.hidden) picker.value = value.value;
  }
  function load(token?: DesignToken) {
    clearTimeout(previewTimer);
    const workspace = options.workspace();
    if (!workspace) return;
    draft = { name: token?.name ?? null, revision: workspace.tokensRevision, dirty: false };
    category.value = token?.category ?? '';
    name.value = token?.name ?? '';
    name.readOnly = Boolean(token);
    type.value = token?.type ?? 'color';
    value.value = token?.value ?? '#303d2b';
    description.value = token?.description ?? '';
    get('token-form-title').textContent = token ? 'Edit token' : 'New token';
    options.onPreview();
    error('');
    controls();
  }
  function mayDiscard() {
    return !saving && (!draft?.dirty || window.confirm('Discard your unsaved token draft?'));
  }
  function render() {
    const workspace = options.workspace();
    if (!workspace) return;
    get('token-count').textContent = `${workspace.tokens.length} shared values`;
    const list = get('token-list');
    list.replaceChildren();
    const suggestions = get<HTMLDataListElement>('token-categories');
    suggestions.replaceChildren();
    for (const label of new Set(workspace.tokens.flatMap((token) => (token.category ? [token.category] : [])))) {
      const option = document.createElement('option');
      option.value = label;
      suggestions.append(option);
    }
    for (const { label, tokens } of groupTokens(workspace.tokens, search.value)) {
      const group = document.createElement('details');
      group.className = 'token-group';
      group.open = Boolean(search.value.trim()) || !collapsed.has(label);
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
      add.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!mayDiscard()) return;
        load();
        const kind = Object.entries(TOKEN_LABELS).find(([, name]) => name === label)?.[0];
        if (kind) {
          const tokenType = Schema.decodeUnknownSync(TokenType)(kind);
          type.value = tokenType;
          value.value = EXAMPLES[tokenType];
        } else category.value = label;
        showDetail(true);
        render();
        name.focus();
      });
      summary.append(title, count, add);
      group.append(summary);
      group.addEventListener('toggle', () => {
        if (group.isConnected && !search.value.trim()) {
          if (group.open) collapsed.delete(label);
          else collapsed.add(label);
        }
      });
      list.append(group);
      for (const token of tokens) {
        const button = document.createElement('button');
        button.className = 'token-row';
        button.type = 'button';
        button.classList.toggle('selected', token.name === draft?.name);
        button.setAttribute('aria-label', `${token.name}, ${token.value}`);
        button.innerHTML = `<span class="token-swatch">${token.type === 'color' ? '' : token.type.startsWith('font') ? 'Aa' : '↔'}</span><span class="token-row-text"><strong>${escapeHtml(token.name)}</strong><span>${escapeHtml(token.value)}</span></span>`;
        if (token.type === 'color') {
          const swatch = button.querySelector<HTMLElement>('.token-swatch');
          if (swatch) swatch.style.backgroundColor = resolvedTokenValue(token, workspace.tokens);
        }
        button.addEventListener('click', () => {
          if (mayDiscard()) {
            load(token);
            showDetail(true);
            render();
            value.focus();
          }
        });
        group.append(button);
      }
    }
    if (!list.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'token-empty';
      empty.textContent = search.value ? 'No matching tokens.' : 'Create a value to reuse across your canvases.';
      list.append(empty);
    }
    controls();
  }
  function draftToken() {
    return Schema.decodeUnknownSync(DesignToken)({
      name: name.value.trim(),
      type: type.value,
      value: value.value.trim(),
      ...(category.value.trim() ? { category: category.value.trim() } : {}),
      ...(description.value.trim() ? { description: description.value.trim() } : {}),
    });
  }
  function previewDraft() {
    const workspace = options.workspace();
    if (!workspace || !draft?.dirty) return;
    try {
      const token = draftToken();
      const preview = previewTokenDraft(workspace.tokens, token, !draft.name);
      if (preview) options.onPreview(preview);
    } catch {
      /* Keep the last valid draft visible while a value is incomplete. */
    }
  }
  function update() {
    const workspace = options.workspace();
    if (!workspace) return;
    if (draft?.dirty) previewDraft();
    if (panel.hidden && get('token-inspector').hidden) return;
    if (draft && !draft.dirty) {
      const current = workspace.tokens.find((token) => token.name === draft?.name);
      if (draft.name && !current) {
        draft = null;
        showDetail(false);
      } else load(current);
    }
    render();
  }
  function showDetail(detail: boolean) {
    if (detail && !options.onInspect()) return;
    form.hidden = !detail;
    if (!detail) options.onClose();
  }
  function back() {
    form.hidden = true;
    options.onClose();
  }
  function revealDraft() {
    options.onLibrary();
    showDetail(true);
    render();
    value.focus();
  }
  function selectToken(tokenName: string) {
    const token = options.workspace()?.tokens.find((token) => token.name === tokenName);
    if (!token) {
      options.notify(`Token '${tokenName}' is not in the shared library.`);
      return;
    }
    if (!mayDiscard()) return;
    load(token);
    options.onLibrary();
    showDetail(true);
    render();
    value.focus();
  }
  async function save() {
    const workspace = options.workspace();
    if (!workspace || !draft || saving) return;
    if (!form.reportValidity()) return;
    saving = true;
    controls();
    error('');
    try {
      const token = draftToken();
      if (!draft.name && workspace.tokens.some((existing) => existing.name === token.name))
        throw new Error('A token with that name already exists. Select it to edit its value.');
      const saved = Schema.decodeUnknownSync(TokenCollection)(
        await options.request('tokens', { tokens: [token], expectedRevision: draft.revision }),
      );
      draft.dirty = false;
      await options.refresh();
      load(saved.tokens.find((candidate) => candidate.name === token.name));
      render();
      options.notify('Token saved. Linked canvases are updated.');
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'Could not save the token.');
    } finally {
      saving = false;
      controls();
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });
  form.addEventListener('input', () => {
    if (draft) draft.dirty = true;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(previewDraft, 120);
    controls();
  });
  const keys = (event: KeyboardEvent) => {
    // Canvas shortcuts must never act on a focused token control.
    event.stopPropagation();
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !form.hidden) {
      event.preventDefault();
      void save();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      back();
    }
  };
  panel.addEventListener('keydown', keys);
  form.addEventListener('keydown', keys);
  get('tokens-button').addEventListener('click', () => {
    options.onLibrary();
    update();
    if (draft) {
      showDetail(true);
      value.focus();
    } else search.focus();
  });
  get('token-back').addEventListener('click', back);
  get('token-discard').addEventListener('click', () => {
    if (saving) return;
    const token = options.workspace()?.tokens.find((token) => token.name === draft?.name);
    load(token);
    render();
    options.notify('Token draft discarded');
  });
  get('token-add-category').addEventListener('click', () => {
    if (!mayDiscard()) return;
    load();
    showDetail(true);
    render();
    category.focus();
  });
  search.addEventListener('input', render);
  get('token-add').addEventListener('click', () => {
    if (mayDiscard()) {
      load();
      showDetail(true);
      render();
      name.focus();
    }
  });
  get('token-copy-reference').addEventListener('click', () => {
    void options
      .copy(tokenVariable(name.value.trim() || 'token-name'))
      .then(() => options.notify('CSS reference copied'))
      .catch((cause) => error(String(cause)));
  });
  get('token-copy-css').addEventListener('click', () => {
    const workspace = options.workspace();
    if (workspace)
      void options
        .copy(tokensCSS(workspace.tokens))
        .then(() => options.notify('Token CSS copied'))
        .catch((cause) => error(String(cause)));
  });
  get('token-color').addEventListener('input', () => {
    value.value = get<HTMLInputElement>('token-color').value;
    if (draft) draft.dirty = true;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(previewDraft, 80);
    controls();
  });
  type.addEventListener('change', () => {
    const tokenType = Schema.decodeUnknownSync(TokenType)(type.value);
    value.placeholder = EXAMPLES[tokenType];
    if (!draft?.name && Object.values(EXAMPLES).includes(value.value)) value.value = EXAMPLES[tokenType];
    previewDraft();
    controls();
  });
  get('token-delete').addEventListener('click', () => {
    if (!draft?.name || saving || !mayDiscard()) return;
    const removed = draft.name,
      revision = draft.revision;
    saving = true;
    controls();
    void options
      .request('tokens/delete', { name: removed, expectedRevision: revision })
      .then(async () => {
        draft = null;
        options.onPreview();
        await options.refresh();
        showDetail(false);
        render();
        options.notify(`Token '${removed}' deleted`);
      })
      .catch((cause) => error(cause instanceof Error ? cause.message : 'Could not delete the token.'))
      .finally(() => {
        saving = false;
        controls();
      });
  });
  return { update, selectToken, revealDraft, hasUnsavedChanges: () => Boolean(draft?.dirty) };
}
