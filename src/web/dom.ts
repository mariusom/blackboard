export function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing workspace element: ${id}`);
  return found as T;
}

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export const icons = {
  undo: '<path d="M9 5 4 10l5 5M4 10h9a7 7 0 0 1 7 7"/>',
  redo: '<path d="m15 5 5 5-5 5m5-5h-9a7 7 0 0 0-7 7"/>',
  select: '<path d="m5 3 13 9-7 1-3 6z"/>',
  hand: '<path d="M8 11V5a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-3a1.5 1.5 0 0 1 3 0v5c0 5-3 7-7 7-3 0-5-2-7-5l-3-4c-1-2 1-3 2-2l3 3"/>',
  frame: '<path d="M7 2v20M17 2v20M2 7h20M2 17h20"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  preview: '<path d="m9 5 10 7-10 7z"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/>',
  export: '<path d="M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  update: '<path d="M12 3v12m-4-4 4 4 4-4M5 17v4h14v-4"/>',
};

export const icon = (value: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${value}</svg>`;

/** Paint the toolbar and tool buttons. Runs once, before any interaction. */
export function applyIcons() {
  for (const [id, value] of Object.entries({
    'updates-button': icons.update,
    'undo-button': icons.undo,
    'redo-button': icons.redo,
    'preview-board': icons.preview,
    'duplicate-board': icons.duplicate,
    'export-board': icons.export,
    'delete-board': icons.trash,
  }))
    element(id).innerHTML = icon(value);
  for (const [name, value] of Object.entries({ select: icons.select, hand: icons.hand, frame: icons.frame })) {
    const button = document.querySelector<HTMLButtonElement>(`[data-tool="${name}"]`);
    if (button) button.innerHTML = icon(value);
  }
  if (window.webkit?.messageHandlers?.blackboard) document.documentElement.classList.add('native');
}

let toastTimer: ReturnType<typeof setTimeout>;
export function toast(message: string) {
  clearTimeout(toastTimer);
  element('toast').textContent = message;
  element('toast').hidden = false;
  toastTimer = setTimeout(() => {
    element('toast').hidden = true;
  }, 4000);
}
