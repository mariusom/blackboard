import { Schema } from "effect"
import { UpdateInfo } from "../domain/models"
import { Workspace } from "./model"

export const WorkspaceState = Schema.Struct({
  workspace: Workspace, update: UpdateInfo, version: Schema.String,
  agent: Schema.Struct({ command: Schema.String, args: Schema.Array(Schema.String) }),
  updatePreview: Schema.Boolean,
})
export interface WorkspaceState extends Schema.Schema.Type<typeof WorkspaceState> {}
