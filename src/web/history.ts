import type { Board } from '../workspace/model';

/** History may only replace the state that its own action left behind. */
export function assertHistorySafe(existing: Board | undefined, expected: Board | null) {
  const message = 'This canvas changed elsewhere. Undo is paused to preserve those changes.';
  if (!existing && !expected) return;
  if (!existing || !expected) throw new Error(message);
  const { id: _existingId, revision: _existingRevision, ...currentFields } = existing;
  const { id: _expectedId, revision: _expectedRevision, ...expectedFields } = expected;
  if (JSON.stringify(currentFields) !== JSON.stringify(expectedFields)) throw new Error(message);
}
