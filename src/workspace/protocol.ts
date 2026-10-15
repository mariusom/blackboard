import { Schema } from 'effect';
import { UpdateInfo } from '../domain/models';
import { Board, Workspace } from './model';

export const WorkspaceState = Schema.Struct({
  workspace: Workspace,
  update: UpdateInfo,
  version: Schema.String,
  agent: Schema.Struct({ command: Schema.String, args: Schema.Array(Schema.String) }),
  updatePreview: Schema.Boolean,
});
export interface WorkspaceState extends Schema.Schema.Type<typeof WorkspaceState> {}

/** A board on the live event stream. `html` is null when the receiver already
 * holds that revision, so editing one canvas does not resend every other
 * canvas's source. Full snapshots (`/api/state`) always carry the HTML. */
export const StreamedBoard = Schema.Struct({ ...Board.fields, html: Schema.NullOr(Schema.String) });
export const StreamedWorkspaceState = Schema.Struct({
  workspace: Schema.Struct({ ...Workspace.fields, boards: Schema.Array(StreamedBoard) }),
  update: UpdateInfo,
  version: Schema.String,
  agent: Schema.Struct({ command: Schema.String, args: Schema.Array(Schema.String) }),
  updatePreview: Schema.Boolean,
});
export interface StreamedWorkspaceState extends Schema.Schema.Type<typeof StreamedWorkspaceState> {}

/** Restore the HTML omitted from a streamed frame using the client's last copy,
 * and never regress a board the client already holds at a newer revision
 * (frames from overlapping broadcasts can arrive out of order). */
export function mergeStreamedState(previous: WorkspaceState | undefined, next: StreamedWorkspaceState): WorkspaceState {
  const byId = new Map(previous?.workspace.boards.map((board) => [board.id, board]));
  const boards: Board[] = next.workspace.boards.map((board) => {
    const previousBoard = byId.get(board.id);
    if (previousBoard && previousBoard.revision > board.revision) return previousBoard;
    const { html, ...rest } = board;
    return { ...rest, html: html ?? previousBoard?.html ?? '' };
  });
  return { ...next, workspace: { ...next.workspace, boards } };
}
