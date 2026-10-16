// Trusted editor bridge. Page-authored scripts remain blocked by the nonce CSP.
const config = JSON.parse(document.currentScript.dataset.config);
const properties = config.properties;
let selected = null;
let overlay;
let marker;
let textEditing = null;
let previousEditable = null;
const nodeKeys = new WeakMap();
let nextKey = 0;
const blocked = 'script,style,link,meta,head,title,noscript,template';

function send(type) {
  if (!selected) return;
  const computed = getComputedStyle(selected);
  const styles = Object.fromEntries(properties.map((property) => [property, computed.getPropertyValue(property)]));
  const declared = Object.fromEntries(properties.map((property) => [property, declaredStyle(selected, property)]));
  if (!nodeKeys.has(selected)) nodeKeys.set(selected, ++nextKey);
  const selection = {
    key: nodeKeys.get(selected),
    tag: selected.tagName.toLowerCase(),
    label: (selected.getAttribute('aria-label') || selected.id || selected.tagName.toLowerCase()).slice(0, 160),
    text: selected.childElementCount ? '' : (selected.textContent || '').slice(0, 20_000),
    editableText:
      selected instanceof HTMLElement &&
      !selected.childElementCount &&
      !selected.matches('img,input,textarea,select,video,audio,iframe,svg,path,br,hr'),
    styles,
    declared,
  };
  const html = type === 'change' ? serialize() : undefined;
  parent.postMessage(
    { channel: config.channel, type, selection, ...(html === undefined ? {} : { html }) },
    config.origin,
  );
}

function rulesValue(rules, node, property) {
  let value = '';
  for (const rule of rules) {
    if (rule.media && !matchMedia(rule.conditionText).matches) continue;
    if (rule.cssRules) value = rulesValue(rule.cssRules, node, property) || value;
    if (!rule.selectorText) continue;
    try {
      if (node.matches(rule.selectorText)) value = rule.style.getPropertyValue(property) || value;
    } catch {
      /* Unsupported selectors do not prevent editing. */
    }
  }
  return value;
}

function declaredStyle(node, property) {
  const inline = node.style?.getPropertyValue(property);
  if (inline) return inline;
  let value = '';
  for (const sheet of document.styleSheets) {
    try {
      value = rulesValue(sheet.cssRules, node, property) || value;
    } catch {
      /* Only local, readable styles can expose token references. */
    }
  }
  // Preserve inherited token bindings for typography and text color.
  if (
    !value &&
    ['color', 'font-family', 'font-size', 'font-weight', 'line-height', 'text-align'].includes(property) &&
    node.parentElement
  )
    return declaredStyle(node.parentElement, property);
  return value;
}

function serialize() {
  const clone = document.body.cloneNode(true);
  clone.querySelector(`[data-blackboard-editor="${config.channel}"]`)?.remove();
  const editing = clone.querySelector(`[data-blackboard-text-edit="${config.channel}"]`);
  if (editing) {
    if (previousEditable === null) editing.removeAttribute('contenteditable');
    else editing.setAttribute('contenteditable', previousEditable);
    editing.removeAttribute('data-blackboard-text-edit');
  }
  return clone.innerHTML;
}

function highlight(node) {
  if (!node || !marker) return;
  const rect = node.getBoundingClientRect();
  marker.style.cssText = `position:fixed;pointer-events:none;box-sizing:border-box;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;border:2px solid #7966e8;background:#7966e809;border-radius:2px;`;
}

function choose(node) {
  if (!(node instanceof Element) || node.closest(blocked) || node === overlay) return;
  if (node !== selected) finishTextEditing();
  selected = node;
  highlight(node);
  send('selection');
}

function validStyle(property, value) {
  return (
    properties.includes(property) &&
    typeof value === 'string' &&
    value.length <= 240 &&
    !/[;{}<>\\@]/.test(value) &&
    !/url\s*\(/i.test(value) &&
    CSS.supports(property, value)
  );
}

function command(event) {
  const data = event.data;
  if (event.source !== parent || event.origin !== config.origin || data?.channel !== config.channel || !selected)
    return;
  if (data.type === 'parent') {
    choose(selected.parentElement);
    return;
  }
  if (
    data.type === 'text' &&
    !selected.childElementCount &&
    typeof data.value === 'string' &&
    data.value.length <= 20_000
  )
    selected.textContent = data.value;
  else if (data.type === 'style' && validStyle(data.property, data.value))
    selected.style.setProperty(data.property, data.value, 'important');
  else return;
  highlight(selected);
  send('change');
}

function finishTextEditing() {
  if (!textEditing) return;
  if (previousEditable === null) textEditing.removeAttribute('contenteditable');
  else textEditing.setAttribute('contenteditable', previousEditable);
  textEditing.removeAttribute('data-blackboard-text-edit');
  textEditing = null;
}

function startTextEditing(event) {
  if (
    !(selected instanceof HTMLElement) ||
    selected.childElementCount ||
    selected.matches('img,input,textarea,select,video,audio,iframe,br,hr')
  )
    return;
  event.preventDefault();
  finishTextEditing();
  textEditing = selected;
  previousEditable = selected.getAttribute('contenteditable');
  selected.dataset.blackboardTextEdit = config.channel;
  selected.contentEditable = 'plaintext-only';
  selected.focus();
  const range = document.createRange();
  range.selectNodeContents(selected);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function wireTextEditing() {
  document.addEventListener('dblclick', startTextEditing, true);
  document.addEventListener(
    'input',
    (event) => {
      if (event.target === textEditing) {
        highlight(selected);
        send('change');
      }
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        finishTextEditing();
        send('selection');
      }
    },
    true,
  );
}

function boot() {
  overlay = document.createElement('div');
  overlay.dataset.blackboardEditor = config.channel;
  overlay.style.cssText =
    'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;display:block!important;';
  const root = overlay.attachShadow({ mode: 'closed' });
  marker = document.createElement('div');
  root.append(marker);
  document.body.append(overlay);
  document.addEventListener(
    'click',
    (event) => {
      if (event.target === textEditing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      choose(event.target);
    },
    true,
  );
  document.addEventListener('submit', (event) => event.preventDefault(), true);
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!selected) highlight(event.target);
    },
    true,
  );
  document.addEventListener('scroll', () => highlight(selected), true);
  window.addEventListener('resize', () => highlight(selected));
  window.addEventListener('message', command);
  wireTextEditing();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
