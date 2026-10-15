import { expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceService } from '../src/workspace/WorkspaceService';
import { exportDocument, previewDocument } from '../src/workspace/model';
import { INITIAL_WORKSPACE, LEGACY_STUDIO_HTML, STUDIO_HTML } from '../src/workspace/templates';
import {
  DEFAULT_TOKENS,
  DesignToken,
  groupTokens,
  resolvedTokenValue,
  tokenReferences,
  tokenValidationError,
  tokensCSS,
} from '../src/workspace/tokens';

const brand: DesignToken = { name: 'brand', type: 'color', value: '#336699', category: 'Brand' };
const alias: DesignToken = { name: 'action', type: 'color', value: 'var(--brand)' };
const empty = { version: 2 as const, name: 'Test', boards: [], tokens: [], tokensRevision: 0 };
const layer = WorkspaceService.makeLayer;
const withFile = <A, E, R>(run: (path: string) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), 'blackboard-tokens-test-'))),
    (directory) => run(join(directory, 'workspace.json')),
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  );

it('validates typed values, aliases, and safe CSS emission', () => {
  const tokens: readonly DesignToken[] = [
    ...DEFAULT_TOKENS,
    brand,
    alias,
    { name: 'gap', type: 'spacing', value: '1.5rem' },
    { name: 'corner', type: 'radius', value: 'var(--gap)' },
    { name: 'weight', type: 'font-weight', value: '500' },
    { name: 'scale', type: 'number', value: '1.2' },
  ];
  expect(tokenValidationError(tokens)).toBeNull();
  expect(tokensCSS(tokens)).toContain('--action: var(--brand);');
  expect(resolvedTokenValue(alias, tokens)).toBe(brand.value);
  expect(tokenReferences('color:var(--brand,#fff);gap:var( --gap );border:var(--brand)')).toEqual(['brand', 'gap']);
  expect(tokenValidationError([alias])).toContain('missing');
  expect(tokenValidationError([brand, { ...alias, type: 'spacing' }])).toContain('cannot reference');
  expect(tokenValidationError([{ ...brand, value: 'var(--action)' }, alias])).toContain('circular');
  expect(tokenValidationError([brand, brand])).toContain('repeated');
});

it('rejects CSS and HTML injection and values incompatible with their types', () => {
  for (const value of [
    'red; background:url(https://example.com)',
    '</style><script>alert(1)</script>',
    'url(https://example.com)',
    '#fff!important',
    'var(--brand, #fff)',
  ]) {
    expect(() => tokensCSS([{ ...brand, value }])).toThrow(/Invalid color value/);
  }
  expect(() => Schema.decodeSync(DesignToken)({ ...brand, name: 'x; color:red' })).toThrow(/string matching/);
  expect(tokenValidationError([{ ...brand, type: 'font-family', value: 'system-ui, url(x)' }])).not.toBeNull();
  expect(tokenValidationError([{ ...brand, type: 'spacing', value: '-1px' }])).not.toBeNull();
  expect(tokenValidationError([{ ...brand, type: 'font-weight', value: '1001' }])).not.toBeNull();
});

it.effect('persists merged tokens with revisions and rejects concurrent stale edits atomically', () =>
  withFile((path) =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const service = yield* WorkspaceService;
        yield* service.upsertTokens({ tokens: [brand, alias], expectedRevision: 0 });
        const outcomes = yield* Effect.forEach(
          ['#112233', '#445566'],
          (value) => Effect.result(service.upsertTokens({ tokens: [{ ...brand, value }], expectedRevision: 1 })),
          { concurrency: 'unbounded' },
        );
        expect(outcomes.filter((result) => result._tag === 'Success')).toHaveLength(1);
        expect(outcomes.filter((result) => result._tag === 'Failure')).toHaveLength(1);
        const saved = yield* service.getTokens;
        expect(saved.revision).toBe(2);
        expect(saved.tokens.find((token) => token.name === 'brand')?.category).toBe('Brand');
        expect(saved.tokens.find((token) => token.name === 'action')).toEqual(alias);
        const invalid = yield* Effect.result(
          service.upsertTokens({ tokens: [{ ...brand, value: 'var(--action)' }], expectedRevision: 2 }),
        );
        expect(invalid._tag).toBe('Failure');
        expect(yield* service.getTokens).toEqual(saved);
        const duplicate = yield* Effect.result(service.upsertTokens({ tokens: [brand, brand] }));
        expect(duplicate._tag).toBe('Failure');
        expect(JSON.parse(yield* Effect.promise(() => readFile(path, 'utf8'))).tokensRevision).toBe(2);
      }).pipe(Effect.provide(layer({ path, initial: empty })));
      const reopened = yield* Effect.flatMap(WorkspaceService, (service) => service.getTokens).pipe(
        Effect.provide(layer({ path })),
      );
      expect(reopened.revision).toBe(2);
    }),
  ),
);

it.effect('guards token deletion for canvas usage and aliases while allowing unused tokens', () =>
  Effect.gen(function* () {
    const service = yield* WorkspaceService;
    yield* service.upsertTokens({ tokens: [brand, alias] });
    expect((yield* Effect.result(service.deleteToken('brand')))._tag).toBe('Failure');
    const board = yield* service.create({ name: 'Linked', html: '<div style="color:var(--action, #fff)">Hello</div>' });
    expect((yield* Effect.result(service.deleteToken('action')))._tag).toBe('Failure');
    yield* service.remove(board.id);
    yield* service.deleteToken('action', 1);
    expect((yield* Effect.result(service.deleteToken('brand', 1)))._tag).toBe('Failure');
    expect((yield* service.deleteToken('brand', 2)).tokens).toEqual([]);
  }).pipe(Effect.provide(layer({ initial: empty }))),
);

it.effect('migrates untouched starter canvases while preserving custom HTML and geometry', () =>
  withFile((path) =>
    Effect.gen(function* () {
      const starter = INITIAL_WORKSPACE.boards[0];
      if (!starter) throw new Error('Expected starter canvas');
      const legacy = {
        version: 1,
        name: 'Existing work',
        boards: [
          { ...starter, html: LEGACY_STUDIO_HTML, revision: 8 },
          { ...starter, id: 'custom', x: -120, html: '<h1>Keep my design</h1>', revision: 4 },
        ],
      };
      yield* Effect.promise(() => writeFile(path, JSON.stringify(legacy)));
      const migrated = yield* Effect.flatMap(WorkspaceService, (service) => service.get).pipe(
        Effect.provide(layer({ path })),
      );
      expect(migrated.version).toBe(2);
      expect(migrated.tokens).toEqual(DEFAULT_TOKENS);
      expect(migrated.boards[0]?.html).toBe(STUDIO_HTML);
      expect(migrated.boards[0]?.revision).toBe(9);
      expect(migrated.boards[1]).toEqual(legacy.boards[1]);
      yield* Effect.flatMap(WorkspaceService, (service) => service.rename('Saved migration')).pipe(
        Effect.provide(layer({ path })),
      );
      expect(JSON.parse(yield* Effect.promise(() => readFile(path, 'utf8'))).version).toBe(2);
    }),
  ),
);

it.effect('preserves an invalid saved token library without overwriting the workspace', () =>
  withFile((path) =>
    Effect.gen(function* () {
      const contents = JSON.stringify({ ...empty, tokens: [alias] });
      yield* Effect.promise(() => writeFile(path, contents));
      const failed = yield* Effect.result(WorkspaceService.pipe(Effect.provide(layer({ path }))));
      expect(failed._tag).toBe('Failure');
      if (failed._tag === 'Failure') expect(failed.failure.message).toContain('missing token');
      expect(yield* Effect.promise(() => readFile(path, 'utf8'))).toBe(contents);
    }),
  ),
);

it('embeds shared values and aliases in both sandboxed previews and standalone exports', () => {
  const source = '<style>h1{color:var(--action)}</style><h1>Shared design</h1>';
  const preview = previewDocument(source, [brand, alias]);
  const exported = exportDocument(source, 'A </title> & B', [brand, alias]);
  for (const html of [preview, exported]) {
    expect(html).toContain('--brand: #336699;');
    expect(html).toContain('--action: var(--brand);');
    expect(html).toContain(source);
  }
  expect(preview).toContain("default-src 'none'");
  expect(exported).toContain('A &lt;/title&gt; &amp; B');
  expect(exported).toContain('data-blackboard-tokens');
});

it('groups custom categories across types and searches category names without changing CSS', () => {
  const gap: DesignToken = { name: 'gap', type: 'spacing', value: '16px', category: 'Brand' };
  const groups = groupTokens([brand, gap, alias]);
  expect(groups.find((group) => group.label === 'Brand')?.tokens).toEqual([brand, gap]);
  expect(groups.find((group) => group.label === 'Colors')?.tokens).toEqual([alias]);
  expect(groupTokens([brand, gap, alias], 'brand').find((group) => group.label === 'Brand')?.tokens).toHaveLength(2);
  expect(groupTokens([brand, gap, alias], 'missing')).toEqual([]);
  expect(tokensCSS([brand, gap])).not.toContain('Brand');
  expect(() => Schema.decodeSync(DesignToken)({ ...brand, category: 'x'.repeat(61) })).toThrow(/60/);
});
