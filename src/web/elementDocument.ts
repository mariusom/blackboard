import { previewDocument } from '../workspace/model';
import type { DesignToken } from '../workspace/tokens';
import inspector from './element-inspector.js' with { type: 'text' };
import { ELEMENT_FIELDS } from './elementProtocol';

export function editableDocument(html: string, tokens: readonly DesignToken[] | undefined, channel: string) {
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="blackboard-editor-nonce"]')?.content;
  if (!nonce) throw new Error('The visual editor is unavailable. Reload Blackboard.');
  const source: unknown = inspector;
  if (typeof source !== 'string') throw new Error('The visual editor bridge was not embedded.');
  const config = JSON.stringify({
    channel,
    origin: location.origin,
    properties: ELEMENT_FIELDS.map((f) => f.property),
  });
  return previewDocument(html, tokens, { nonce, script: source, config });
}
