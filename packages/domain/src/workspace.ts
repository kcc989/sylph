import { Schema } from "effect"

import { ProjectId, WorkspaceId } from "./ids"
import { ModelSelection } from "./provider-connection"

export const WorkspaceStatus = Schema.Literals([
  "provisioning",
  "ready",
  "running",
  "waiting",
  "idle",
  "interrupted",
  "merging",
  "archived",
  "error",
])
export type WorkspaceStatus = typeof WorkspaceStatus.Type

export class WorkspaceSummary extends Schema.Class<WorkspaceSummary>(
  "@sylph/domain/WorkspaceSummary"
)({
  id: WorkspaceId,
  projectId: ProjectId,
  title: Schema.NonEmptyString,
  status: WorkspaceStatus,
}) {}

export class CreateWorkspaceInput extends Schema.Class<CreateWorkspaceInput>(
  "@sylph/domain/CreateWorkspaceInput"
)({
  projectId: ProjectId,
  idempotencyKey: Schema.NonEmptyString,
}) {}

const workspaceAdjectives = [
  "amber",
  "brisk",
  "calm",
  "cobalt",
  "coral",
  "eager",
  "gentle",
  "golden",
  "lucky",
  "quiet",
  "silver",
  "swift",
] as const

const workspaceAnimals = [
  "badger",
  "bison",
  "falcon",
  "fox",
  "heron",
  "lynx",
  "otter",
  "panda",
  "raven",
  "seal",
  "tiger",
  "wolf",
] as const

const randomItem = <T>(items: readonly T[], random: () => number) => {
  const index = Math.min(
    items.length - 1,
    Math.max(0, Math.floor(random() * items.length))
  )
  return items[index]
}

export const randomWorkspaceName = (random: () => number = Math.random) =>
  `${randomItem(workspaceAdjectives, random)}-${randomItem(workspaceAnimals, random)}`

export class WorkspaceRequestInput extends Schema.Class<WorkspaceRequestInput>(
  "@sylph/domain/WorkspaceRequestInput"
)({
  workspaceId: WorkspaceId,
}) {}

export class RestartWorkspaceInput extends Schema.Class<RestartWorkspaceInput>(
  "@sylph/domain/RestartWorkspaceInput"
)({
  workspaceId: WorkspaceId,
  model: Schema.optional(ModelSelection),
}) {}

export class InvalidWorkspaceInput extends Schema.TaggedError<InvalidWorkspaceInput>()(
  "InvalidWorkspaceInput",
  {
    message: Schema.String,
  }
) {}
