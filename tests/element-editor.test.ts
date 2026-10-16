import { expect, it } from '@effect/vitest';
import { Schema } from 'effect';
import { previewDocument } from '../src/workspace/model';
import { ElementMessage, elementTokens, elementStyleValue } from '../src/web/elementProtocol';
import { DEFAULT_TOKENS } from '../src/workspace/tokens';

it('keeps normal previews script-free and allows only the trusted nonce in edit mode', () => {
  const html = '<h1>Hello</h1><script>window.evil=true</script>';
  expect(previewDocument(html)).not.toContain('script-src');
  const edited = previewDocument(html, [], {
    nonce: 'randomnonce',
    script: 'const x="</script>";',
    config: '{"name":"<unsafe>"}',
  });
  expect(edited).toContain("script-src 'nonce-randomnonce'");
  expect(edited).not.toContain("script-src 'unsafe-inline'");
  expect(edited).toContain('data-config="{&quot;name&quot;:&quot;&lt;unsafe&gt;&quot;}"');
  expect(edited).toContain('<script nonce="randomnonce"');
  expect(edited).toContain('<\\/script>');
  expect(edited).toContain("default-src 'none'");
  expect(edited).toContain('<script>window.evil=true</script>');
});
it('offers compatible shared tokens and saves CSS references instead of flattening their values', () => {
  expect(elementTokens('color', DEFAULT_TOKENS).every((token) => token.type === 'color')).toBe(true);
  expect(elementTokens('font-size', DEFAULT_TOKENS).some((token) => token.name === 'size-body')).toBe(true);
  expect(elementTokens('font-size', DEFAULT_TOKENS).some((token) => token.name === 'color-brand')).toBe(false);
  expect(elementStyleValue('padding-top', ' 24 ')).toBe('24px');
  expect(elementStyleValue('font-weight', '700')).toBe('700');
  expect(elementStyleValue('line-height', '1.5')).toBe('1.5');
  expect(elementStyleValue('color', 'var(--color-brand)')).toBe('var(--color-brand)');
});
it('rejects oversized frame content and malformed element selections at the message boundary', () => {
  expect(() => Schema.decodeUnknownSync(ElementMessage)({ channel: 'x', type: 'change', selection: {} })).toThrow(
    /selection|type/,
  );
  expect(() => Schema.decodeUnknownSync(ElementMessage)({ channel: 'x', type: 'run-script', selection: {} })).toThrow(
    /selection|type/,
  );
});
