import { app } from './appState';
import { element } from './dom';
import { ELEMENT_FIELDS, elementTokens, type ElementProperty } from './elementProtocol';

const choices: Partial<Record<ElementProperty, readonly string[]>> = {
  'text-align': ['left', 'center', 'right', 'justify', 'start', 'end'],
  'font-weight': ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'normal', 'bold'],
  display: ['block', 'flex', 'grid', 'inline', 'inline-block', 'none'],
  'flex-direction': ['row', 'column', 'row-reverse', 'column-reverse'],
  'align-items': ['normal', 'start', 'center', 'end', 'stretch', 'baseline'],
  'justify-content': ['normal', 'start', 'center', 'end', 'space-between', 'space-around', 'space-evenly'],
};
const pixelFields = new Set([
  'font-size',
  'border-radius',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'gap',
  'width',
  'height',
]);
type ApplyStyle = (property: ElementProperty, value: string) => void;

function tokenMenu(property: ElementProperty, label: string, apply: ApplyStyle) {
  const wrapper = document.createElement('span');
  wrapper.className = 'element-token-menu';
  wrapper.textContent = '◈';
  const picker = document.createElement('select');
  picker.id = `element-token-${property}`;
  picker.setAttribute('aria-label', `Token for ${label}`);
  picker.addEventListener('change', () => {
    const value = picker.value || app.visualEditor?.selection?.styles[property];
    if (value) apply(property, value);
  });
  wrapper.append(picker);
  return wrapper;
}

function valueInput(property: ElementProperty, label: string, apply: ApplyStyle) {
  const options = choices[property];
  const input = options ? document.createElement('select') : document.createElement('input');
  input.id = `element-${property}`;
  input.setAttribute('aria-label', label);
  if (input instanceof HTMLInputElement) {
    input.maxLength = 240;
    if (property === 'font-family') input.setAttribute('list', 'element-font-families');
  } else for (const option of options ?? []) input.append(new Option(option, option));
  input.addEventListener('change', () => apply(property, input.value));
  return input;
}

function colorPicker(property: ElementProperty, label: string, apply: ApplyStyle) {
  const color = document.createElement('input');
  color.type = 'color';
  color.id = `element-swatch-${property}`;
  color.setAttribute('aria-label', `${label} color picker`);
  color.addEventListener('input', () => apply(property, color.value));
  return color;
}

function styleControl(field: (typeof ELEMENT_FIELDS)[number], apply: ApplyStyle) {
  const { property, label } = field;
  const row = document.createElement('div');
  row.className = 'element-control';
  const title = document.createElement('label');
  title.htmlFor = `element-${property}`;
  title.textContent = label.replace('Padding ', '');
  const value = document.createElement('div');
  value.className = 'element-control-value';
  if (property === 'color' || property === 'background-color') value.append(colorPicker(property, label, apply));
  value.append(valueInput(property, label, apply));
  if (pixelFields.has(property)) {
    const unit = document.createElement('small');
    unit.id = `element-unit-${property}`;
    unit.textContent = 'px';
    value.append(unit);
  }
  value.append(tokenMenu(property, label, apply));
  row.append(title, value);
  return row;
}

export function buildElementControls(apply: ApplyStyle) {
  const host = element('element-styles');
  for (const group of ['Appearance', 'Typography', 'Spacing', 'Layout']) {
    const section = document.createElement('details');
    section.className = 'element-style-group';
    section.open = group === 'Appearance' || group === 'Typography';
    const summary = document.createElement('summary');
    summary.textContent = group;
    const fields = document.createElement('div');
    fields.className = 'element-control-grid';
    for (const field of ELEMENT_FIELDS) if (field.group === group) fields.append(styleControl(field, apply));
    section.append(summary, fields);
    host.append(section);
  }
}

function renderTokenMenu(property: ElementProperty, value: string) {
  const picker = element<HTMLSelectElement>(`element-token-${property}`);
  if (document.activeElement === picker) return;
  picker.replaceChildren(new Option(value.startsWith('var(') ? 'Detach token' : 'Apply a token…', ''));
  for (const token of elementTokens(property, app.state?.workspace.tokens ?? []))
    picker.append(new Option(token.name, `var(--${token.name})`));
  picker.value = value.startsWith('var(') ? value : '';
  picker.parentElement?.classList.toggle('bound', value.startsWith('var('));
  if (picker.parentElement) picker.parentElement.hidden = picker.options.length === 1;
  picker.disabled = Boolean(app.visualEditor?.saving);
}

function renderValue(property: ElementProperty, value: string) {
  const input = element<HTMLInputElement | HTMLSelectElement>(`element-${property}`);
  if (document.activeElement === input) return;
  const bound = /^var\(\s*--([a-z0-9-]+)\s*\)$/.exec(value);
  input.classList.toggle('token-bound', Boolean(bound));
  if (input instanceof HTMLInputElement) {
    const pixels = pixelFields.has(property) && /^\d+(?:\.\d+)?px$/.test(value);
    input.type = pixels ? 'number' : 'text';
    input.step = '1';
    input.min = '0';
    input.readOnly = Boolean(bound);
    input.value = bound?.[1] ?? (pixels ? value.slice(0, -2) : value);
    input.title = bound ? `Linked to ${value}. Use the token menu to detach.` : '';
    if (pixelFields.has(property)) element(`element-unit-${property}`).hidden = !pixels;
  } else {
    if (![...input.options].some((option) => option.value === value)) input.append(new Option(value, value));
    input.value = value;
  }
  input.disabled = Boolean(app.visualEditor?.saving);
}

export function renderElementControls() {
  const selection = app.visualEditor?.selection;
  if (!selection) return;
  for (const { property } of ELEMENT_FIELDS) {
    const declared = selection.declared[property] ?? '';
    const value = declared.includes('var(') ? declared : (selection.styles[property] ?? '');
    renderValue(property, value);
    renderTokenMenu(property, value);
    if (property === 'color' || property === 'background-color') {
      const swatch = element<HTMLInputElement>(`element-swatch-${property}`);
      swatch.value = colorHex(selection.styles[property] ?? '') ?? '#000000';
      swatch.disabled = Boolean(app.visualEditor?.saving);
    }
  }
}

export function colorHex(value: string): string | undefined {
  if (/^#[a-f0-9]{6}$/i.test(value)) return value;
  const rgb = /^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/.exec(value);
  if (!rgb) return undefined;
  return `#${rgb
    .slice(1, 4)
    .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, '0'))
    .join('')}`;
}
