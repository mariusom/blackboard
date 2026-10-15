import { expect, it } from '@effect/vitest';
import { Effect, Fiber, Schema, Stream } from 'effect';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WorkspaceService } from '../src/workspace/WorkspaceService';
import { fitBoards, zoomAt, type Board } from '../src/workspace/model';
import { StreamedWorkspaceState, WorkspaceState, mergeStreamedState } from '../src/workspace/protocol';
import { INITIAL_UPDATE_INFO } from '../src/domain/models';

const input = { name: 'Generated canvas', html: '<h1>Hello</h1>', width: 800, height: 600 };
const withWorkspace = <A, E, R>(run: (path: string) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), 'blackboard-workspace-test-'))),
    (root) => run(join(root, 'workspace.json')),
    (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
  );
const readJson = (file: string) => Effect.promise(async () => JSON.parse(await readFile(file, 'utf8')));
const layer = WorkspaceService.makeLayer;

it.effect('persists HTML, geometry, naming, and deletion across app restarts', () =>
  withWorkspace((path) =>
    Effect.gen(function* () {
      const board = yield* Effect.gen(function* () {
        const workspace = yield* WorkspaceService;
        const created = yield* workspace.create(input);
        const updated = yield* workspace.update(created.id, {
          html: '<h1>Saved HTML</h1>',
          x: -300,
          y: 250,
          width: 900,
          expectedRevision: created.revision,
        });
        yield* workspace.rename('Design explorations');
        return updated;
      }).pipe(Effect.provide(layer({ path, initial: { version: 1, name: 'Test', boards: [] } })));
      yield* Effect.gen(function* () {
        const workspace = yield* WorkspaceService;
        const saved = yield* workspace.get;
        expect(saved.name).toBe('Design explorations');
        expect(saved.boards).toEqual([board]);
        yield* workspace.remove(board.id);
        expect((yield* readJson(path)).boards).toEqual([]);
      }).pipe(Effect.provide(layer({ path })));
    }),
  ),
);

it.effect('serializes concurrent creates without dropping canvases or reusing IDs', () =>
  withWorkspace((path) =>
    Effect.gen(function* () {
      const boards = yield* Effect.all(
        Array.from({ length: 12 }, (_, index) =>
          WorkspaceService.pipe(Effect.flatMap((workspace) => workspace.create({ ...input, name: String(index) }))),
        ),
        { concurrency: 'unbounded' },
      );
      const saved = yield* Effect.flatMap(WorkspaceService, (workspace) => workspace.get);
      expect(saved.boards).toHaveLength(12);
      expect(new Set(boards.map((b) => b.id)).size).toBe(12);
      expect(new Set(boards.map((b) => b.x)).size).toBe(12);
    }).pipe(Effect.provide(layer({ path, initial: { version: 1, name: 'Test', boards: [] } }))),
  ),
);

it.effect('rejects stale HTML edits while allowing partial geometry changes to preserve generated content', () =>
  Effect.gen(function* () {
    const workspace = yield* WorkspaceService;
    const created = yield* workspace.create(input);
    yield* workspace.update(created.id, { html: '<h1>Agent change</h1>', expectedRevision: 0 });
    const stale = yield* Effect.result(
      workspace.update(created.id, { html: '<h1>Old draft</h1>', expectedRevision: 0 }),
    );
    const moved = yield* workspace.update(created.id, { x: 500 });
    expect(stale._tag).toBe('Failure');
    if (stale._tag === 'Failure') expect(stale.failure.code).toBe('conflict');
    expect(moved.html).toBe('<h1>Agent change</h1>');
    expect(moved.x).toBe(500);
  }).pipe(Effect.provide(layer())),
);

it.effect('rejects a workspace that grows past the storage budget without changing live state', () =>
  Effect.gen(function* () {
    const workspace = yield* WorkspaceService;
    const before = yield* workspace.get;
    const failed = yield* Effect.result(workspace.create({ ...input, html: `<!--${'x'.repeat(5000)}-->` }));
    expect(failed._tag).toBe('Failure');
    if (failed._tag === 'Failure') expect(failed.failure.code).toBe('invalid');
    expect(yield* workspace.get).toEqual(before);
  }).pipe(Effect.provide(layer({ maxBytes: 4096 }))),
);

it('restores omitted streamed HTML and ignores out-of-order frames', () => {
  const board = { ...input, id: 'a', x: 0, y: 0, revision: 3 };
  const base = {
    workspace: { version: 2, name: 'Test', boards: [board], tokens: [], tokensRevision: 0 },
    update: INITIAL_UPDATE_INFO,
    version: '1',
    agent: { command: 'bun', args: [] },
    updatePreview: false,
  };
  const previous = Schema.decodeUnknownSync(WorkspaceState)(base);
  const frame = (over: { html?: string | null; revision?: number }) =>
    Schema.decodeUnknownSync(StreamedWorkspaceState)({
      ...base,
      workspace: { ...base.workspace, boards: [{ ...board, ...over }] },
    });
  const merged = mergeStreamedState(previous, frame({ html: null }));
  expect(merged.workspace.boards[0].html).toBe('<h1>Hello</h1>');
  expect(merged.workspace.boards[0].revision).toBe(3);
  const fresh = frame({ revision: 4, html: '<h1>Fresh</h1>' });
  expect(mergeStreamedState(previous, fresh).workspace.boards[0].html).toBe('<h1>Fresh</h1>');
  expect(mergeStreamedState(previous, fresh).workspace.boards[0].revision).toBe(4);
  const stale = mergeStreamedState(previous, frame({ revision: 2, html: '<h1>Old</h1>' }));
  expect(stale.workspace.boards[0].revision).toBe(3);
  expect(stale.workspace.boards[0].html).toBe('<h1>Hello</h1>');
  expect(mergeStreamedState(undefined, fresh).workspace.boards[0].html).toBe('<h1>Fresh</h1>');
});

it.effect('recovers the newest snapshot when the workspace file is missing', () =>
  withWorkspace((path) =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const workspace = yield* WorkspaceService;
        const board = yield* workspace.create({ ...input, name: 'Alpha' });
        yield* workspace.update(board.id, { name: 'Beta' });
      }).pipe(Effect.provide(layer({ path })));
      yield* Effect.promise(() => rm(path));
      const saved = yield* Effect.flatMap(WorkspaceService, (workspace) => workspace.get).pipe(
        Effect.provide(layer({ path })),
      );
      expect(saved.boards[0]?.name).toBe('Alpha');
    }),
  ),
);

it.effect('rejects an oversized workspace before writing the file or any snapshot', () =>
  withWorkspace((path) =>
    Effect.gen(function* () {
      const failed = yield* Effect.result(
        Effect.flatMap(WorkspaceService, (workspace) =>
          workspace.create({ ...input, html: `<!--${'x'.repeat(6000)}-->` }),
        ).pipe(Effect.provide(layer({ path, maxBytes: 4096 }))),
      );
      expect(failed._tag).toBe('Failure');
      expect(yield* Effect.promise(() => readdir(dirname(path)))).toEqual([]);
    }),
  ),
);

it.effect('keeps the previous saved versions as a rotating ring of backups', () =>
  withWorkspace((path) =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const workspace = yield* WorkspaceService;
        const board = yield* workspace.create({ ...input, name: 'First' });
        yield* workspace.update(board.id, { name: 'Second' });
        yield* workspace.update(board.id, { name: 'Third' });
      }).pipe(Effect.provide(layer({ path })));
      expect((yield* readJson(path)).boards[0].name).toBe('Third');
      expect((yield* readJson(`${path}.1.bak`)).boards[0].name).toBe('Second');
      expect((yield* readJson(`${path}.2.bak`)).boards[0].name).toBe('First');
    }),
  ),
);

it.effect('bounds the backup ring and leaves no temporary files behind', () =>
  withWorkspace((path) =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const workspace = yield* WorkspaceService;
        const board = yield* workspace.create(input);
        for (let index = 0; index < 8; index++) yield* workspace.update(board.id, { x: index });
      }).pipe(Effect.provide(layer({ path })));
      const entries = yield* Effect.promise(() => readdir(dirname(path)));
      expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([]);
      expect(entries).toContain('workspace.json.5.bak');
      expect(entries).not.toContain('workspace.json.6.bak');
    }),
  ),
);

it.effect('broadcasts committed state to a live canvas subscription', () =>
  Effect.gen(function* () {
    const workspace = yield* WorkspaceService;
    const subscribed = Promise.withResolvers<void>();
    const fiber = yield* workspace.changes.pipe(
      Stream.tap(() => Effect.sync(() => subscribed.resolve())),
      Stream.take(2),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* Effect.promise(() => subscribed.promise);
    const board = yield* workspace.create(input);
    const events = yield* Fiber.join(fiber);
    expect(events[1].boards.at(-1)?.id).toBe(board.id);
  }).pipe(Effect.provide(layer())),
);

it.effect('preserves canvas IDs during undo restoration and protects deletion against concurrent edits', () =>
  Effect.gen(function* () {
    const workspace = yield* WorkspaceService;
    const original = yield* workspace.create(input);
    const changed = yield* workspace.update(original.id, { html: '<h1>New work</h1>' });
    const staleDelete = yield* Effect.result(workspace.remove(original.id, original.revision));
    yield* workspace.remove(changed.id, changed.revision);
    const restored = yield* workspace.create(changed);
    const duplicateId = yield* Effect.result(workspace.create(changed));
    const staleEdit = yield* Effect.result(
      workspace.update(restored.id, { html: '<h1>Old agent work</h1>', expectedRevision: original.revision }),
    );
    expect(restored.id).toBe(original.id);
    expect(restored.html).toBe('<h1>New work</h1>');
    expect(staleDelete._tag).toBe('Failure');
    expect(duplicateId._tag).toBe('Failure');
    expect(staleEdit._tag).toBe('Failure');
  }).pipe(Effect.provide(layer())),
);

it.effect('preserves a damaged workspace instead of silently replacing it', () =>
  withWorkspace((path) =>
    Effect.gen(function* () {
      const damaged = '{"version":1,"boards":invalid';
      yield* Effect.promise(() => writeFile(path, damaged));
      const failed = yield* Effect.result(
        Effect.flatMap(WorkspaceService, (workspace) => workspace.get).pipe(Effect.provide(layer({ path }))),
      );
      expect(failed._tag).toBe('Failure');
      if (failed._tag === 'Failure') expect(failed.failure.message).toContain('preserved');
      expect(yield* Effect.promise(() => readFile(path, 'utf8'))).toBe(damaged);
    }),
  ),
);

it.effect('keeps live state unchanged when saving fails and rejects invalid dimensions', () =>
  withWorkspace((path) =>
    Effect.gen(function* () {
      const result = yield* Effect.gen(function* () {
        const workspace = yield* WorkspaceService;
        const before = yield* workspace.get;
        yield* Effect.promise(() => writeFile(path, 'a file blocks the parent directory'));
        const failed = yield* Effect.result(workspace.create(input));
        const invalid = yield* Effect.result(workspace.create({ ...input, width: -1 }));
        return { before, failed, invalid, after: yield* workspace.get };
      }).pipe(Effect.provide(layer({ path: join(path, 'cannot', 'write.json') })));
      expect(result.failed._tag).toBe('Failure');
      expect(result.invalid._tag).toBe('Failure');
      expect(result.after).toEqual(result.before);
    }),
  ),
);

it('keeps the point under the cursor stationary while zooming and fits negative canvas positions', () => {
  const camera = { x: -250, y: 70, zoom: 0.8 },
    point = { x: 600, y: 400 };
  const next = zoomAt(camera, 1.6, point);
  expect((point.x - next.x) / next.zoom).toBe((point.x - camera.x) / camera.zoom);
  expect((point.y - next.y) / next.zoom).toBe((point.y - camera.y) / camera.zoom);
  const boards: Board[] = [
    { ...input, id: 'a', x: -1200, y: -500, revision: 0 },
    { ...input, id: 'b', x: 50, y: 100, revision: 0 },
  ];
  const fit = fitBoards(boards, 1400, 900);
  for (const b of boards) {
    expect(b.x * fit.zoom + fit.x).toBeGreaterThan(0);
    expect((b.x + b.width) * fit.zoom + fit.x).toBeLessThan(1400);
    expect(b.y * fit.zoom + fit.y).toBeGreaterThan(0);
    expect((b.y + b.height) * fit.zoom + fit.y).toBeLessThan(900);
  }
});
