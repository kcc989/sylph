import { GitCommitId } from "./version-control"
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

export class WorkspaceReadInput extends Schema.Class<WorkspaceReadInput>(
  "@sylph/domain/WorkspaceReadInput"
)({
  workspaceId: WorkspaceId,
  includeOptions: Schema.optional(Schema.Boolean),
}) {}

export class ProjectSynchronizationInput extends Schema.Class<ProjectSynchronizationInput>(
  "@sylph/domain/ProjectSynchronizationInput"
)({
  id: ProjectId,
  userId: Schema.NonEmptyString,
  repositoryName: Schema.NonEmptyString,
  repositoryRemote: Schema.NonEmptyString,
  defaultRef: Schema.NonEmptyString,
  sourceUrl: Schema.NullOr(Schema.String),
  sourceRef: Schema.NullOr(Schema.String),
}) {}

export class WorkspacePatchReadInput extends Schema.Class<WorkspacePatchReadInput>(
  "@sylph/domain/WorkspacePatchReadInput"
)({
  workspaceId: WorkspaceId,
  scope: Schema.Literals(["working", "branch"]),
  expectedCommit: GitCommitId,
}) {}
