import { expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

it('preserves root language and body attributes when a full website is saved visually', () => {
  const source = readFileSync(new URL('../src/web/element-inspector.js', import.meta.url), 'utf8');
  const content = '<main><h1>Edited heading</h1></main>';
  const root = `<html lang="fr"><head></head><body class="page" data-theme="dark">${content}</body></html>`;
  const clone = { innerHTML: content, outerHTML: root, querySelector: () => null, querySelectorAll: () => [] };
  const document = {
    currentScript: {
      dataset: { config: JSON.stringify({ channel: 'test', properties: [], origin: 'http://127.0.0.1' }) },
    },
    head: { children: [] },
    body: { cloneNode: () => clone },
    documentElement: { cloneNode: () => clone },
    readyState: 'loading',
    addEventListener: () => {},
  };
  const saved = runInNewContext(`${source}\nserialize()`, { document });
  expect(saved).toContain('<html lang="fr">');
  expect(saved).toContain('<body class="page" data-theme="dark">');
  expect(saved).toContain('<h1>Edited heading</h1>');
});
