import { afterEach, expect, it } from '@effect/vitest';
import { vi } from 'vitest';
import { createDOMPreview } from '../src/web/preview';

afterEach(() => vi.unstubAllGlobals());

it('grants the trusted edit bridge scripting without ever granting the application origin', () => {
  const attrs = new Map<string, string>();
  const frame = {
    setAttribute: (key: string, value: string) => attrs.set(key, value),
    addEventListener: vi.fn<() => void>(),
    classList: { add: vi.fn<() => void>() },
    style: {},
  };
  vi.stubGlobal('document', { createElement: () => frame });
  const host = { append: vi.fn<() => void>() } as unknown as HTMLElement;
  const normal = createDOMPreview(host);
  normal.render('preview', 'Canvas');
  expect(attrs.get('sandbox')).toBe('');
  expect(attrs.get('referrerpolicy')).toBe('no-referrer');
  const editing = createDOMPreview(host, { interactive: true });
  editing.render('editing', 'Canvas');
  expect(attrs.get('sandbox')).toBe('allow-scripts');
  expect(attrs.get('sandbox')).not.toContain('allow-same-origin');
  expect(attrs.get('sandbox')).not.toContain('allow-forms');
});
