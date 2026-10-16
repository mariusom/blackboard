import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { nextBoardPosition, type Board } from '../src/workspace/model';
import { WorkspaceService } from '../src/workspace/WorkspaceService';
import { EMPTY_WORKSPACE } from '../src/workspace/templates';
const board = (id: string, x: number, y: number): Board => ({
  id,
  x,
  y,
  width: 760,
  height: 560,
  name: id,
  html: '',
  revision: 0,
});

it('places automatic additions after the last canvas and skips occupied space', () => {
  expect(nextBoardPosition([])).toEqual({ x: 0, y: 0 });
  expect(nextBoardPosition([board('a', 0, 0)])).toEqual({ x: 840, y: 0 });
  expect(nextBoardPosition([board('a', 840, 0), board('last', 0, 0)])).toEqual({ x: 1680, y: 0 });
  expect(nextBoardPosition([board('last', 0, 900)])).toEqual({ x: 840, y: 900 });
  expect(nextBoardPosition([board('last', 99_000, 0)])).toEqual({ x: 0, y: 640 });
});
it.effect('serializes concurrent automatic placements while preserving explicitly drawn geometry', () =>
  Effect.gen(function* () {
    const service = yield* WorkspaceService;
    const created = yield* Effect.all(
      [
        service.create({ name: 'One', html: '' }),
        service.create({ name: 'Two', html: '' }),
        service.create({ name: 'Three', html: '' }),
      ],
      { concurrency: 'unbounded' },
    );
    expect(created.map((canvas) => canvas.x).toSorted((a, b) => a - b)).toEqual([0, 840, 1680]);
    const drawn = yield* service.create({ name: 'Drawn', html: '', x: 24, y: 80, width: 300, height: 200 });
    expect({ x: drawn.x, y: drawn.y, width: drawn.width, height: drawn.height }).toEqual({
      x: 24,
      y: 80,
      width: 300,
      height: 200,
    });
  }).pipe(Effect.provide(WorkspaceService.makeLayer({ initial: EMPTY_WORKSPACE }))),
);
