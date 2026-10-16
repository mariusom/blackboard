import { Schema } from 'effect';
import type { DesignToken } from '../workspace/tokens';

export const ELEMENT_FIELDS = [
  { property: 'color', label: 'Text color', group: 'Appearance', types: ['color'] },
  { property: 'background-color', label: 'Fill', group: 'Appearance', types: ['color'] },
  { property: 'border-radius', label: 'Corner radius', group: 'Appearance', types: ['radius', 'spacing'] },
  { property: 'font-family', label: 'Font family', group: 'Typography', types: ['font-family'] },
  { property: 'font-size', label: 'Font size', group: 'Typography', types: ['font-size', 'spacing'] },
  { property: 'font-weight', label: 'Font weight', group: 'Typography', types: ['font-weight', 'number'] },
  { property: 'line-height', label: 'Line height', group: 'Typography', types: ['number', 'font-size'] },
  { property: 'text-align', label: 'Text alignment', group: 'Typography', types: [] },
  { property: 'padding-top', label: 'Padding top', group: 'Spacing', types: ['spacing'] },
  { property: 'padding-right', label: 'Padding right', group: 'Spacing', types: ['spacing'] },
  { property: 'padding-bottom', label: 'Padding bottom', group: 'Spacing', types: ['spacing'] },
  { property: 'padding-left', label: 'Padding left', group: 'Spacing', types: ['spacing'] },
  { property: 'gap', label: 'Gap', group: 'Spacing', types: ['spacing'] },
  { property: 'width', label: 'Width', group: 'Layout', types: ['spacing'] },
  { property: 'height', label: 'Height', group: 'Layout', types: ['spacing'] },
  { property: 'display', label: 'Display', group: 'Layout', types: [] },
  { property: 'flex-direction', label: 'Direction', group: 'Layout', types: [] },
  { property: 'align-items', label: 'Align items', group: 'Layout', types: [] },
  { property: 'justify-content', label: 'Distribute', group: 'Layout', types: [] },
] as const;
export type ElementProperty = (typeof ELEMENT_FIELDS)[number]['property'];
export const elementTokens = (property: ElementProperty, tokens: readonly DesignToken[]) => {
  const field = ELEMENT_FIELDS.find((field) => field.property === property);
  return tokens.filter((token) => field?.types.some((type) => type === token.type));
};
export const ElementSelection = Schema.Struct({
  key: Schema.Int,
  tag: Schema.String.check(Schema.isMaxLength(80)),
  label: Schema.String.check(Schema.isMaxLength(160)),
  text: Schema.String.check(Schema.isMaxLength(20_000)),
  editableText: Schema.Boolean,
  styles: Schema.Record(Schema.String, Schema.String),
  declared: Schema.Record(Schema.String, Schema.String),
});
export interface ElementSelection extends Schema.Schema.Type<typeof ElementSelection> {}
export const ElementMessage = Schema.Struct({
  channel: Schema.String,
  type: Schema.Literals(['selection', 'change']),
  selection: ElementSelection,
  html: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2_000_000))),
});

const pixelProperties = new Set<ElementProperty>([
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
export function elementStyleValue(property: ElementProperty, value: string): string {
  const trimmed = value.trim();
  return pixelProperties.has(property) && /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed) ? `${trimmed}px` : trimmed;
}

export function elementLabel(tag: string, label: string): string {
  const names: Record<string, string> = {
    h1: 'Heading',
    h2: 'Heading',
    h3: 'Heading',
    p: 'Paragraph',
    span: 'Text',
    button: 'Button',
    a: 'Link',
    div: 'Container',
    main: 'Main container',
    section: 'Section',
    img: 'Image',
    svg: 'Illustration',
  };
  const name = names[tag] ?? tag;
  return label === tag ? name : `${name} · ${label}`;
}
