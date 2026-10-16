import { expect, it } from '@effect/vitest';
import type { Board } from '../src/workspace/model';
import { assertHistorySafe } from '../src/web/history';

const board: Board = { id: 'a', name: 'Canvas', x: 0, y: 0, width: 760, height: 560, html: 'Original', revision: 1 };
it('does not resurrect a canvas removed elsewhere or overwrite a recreated canvas during undo', () => {
  expect(() => assertHistorySafe(undefined, board)).toThrow('changed elsewhere');
  expect(() => assertHistorySafe({ ...board, html: 'New work' }, null)).toThrow('changed elsewhere');
  expect(() => assertHistorySafe({ ...board, html: 'Agent edit' }, board)).toThrow('changed elsewhere');
});
it('allows history at the expected state even after an earlier undo changed its revision', () => {
  expect(() => assertHistorySafe({ ...board, revision: 10 }, board)).not.toThrow();
  expect(() => assertHistorySafe(undefined, null)).not.toThrow();
});
