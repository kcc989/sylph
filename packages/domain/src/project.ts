import { Schema } from "effect"

import { OrganizationId, ProjectId } from "./ids"

export const GitHubImportMode = Schema.Literals(["connected", "copy"])
export type GitHubImportMode = typeof GitHubImportMode.Type

export const ProjectSource = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("template"),
    template: Schema.NonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("github"),
    url: Schema.NonEmptyString,
    branch: Schema.optional(Schema.NonEmptyString),
    mode: GitHubImportMode,
  }),
  Schema.Struct({
    kind: Schema.Literal("empty"),
  }),
])
export type ProjectSource = typeof ProjectSource.Type

export class CreateProjectInput extends Schema.Class<CreateProjectInput>(
  "@sylph/domain/CreateProjectInput"
)({
  organizationId: OrganizationId,
  name: Schema.NonEmptyString,
  source: ProjectSource,
}) {}

export class ProjectTemplate extends Schema.Class<ProjectTemplate>(
  "@sylph/domain/ProjectTemplate"
)({
  key: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  description: Schema.String,
  sourceUrl: Schema.NonEmptyString,
  sourceRef: Schema.NonEmptyString,
}) {}

export class ProjectTemplateCatalog extends Schema.Class<ProjectTemplateCatalog>(
  "@sylph/domain/ProjectTemplateCatalog"
)({
  templates: Schema.Array(ProjectTemplate),
  defaultTemplate: Schema.NonEmptyString,
}) {}

export class ProjectRequestInput extends Schema.Class<ProjectRequestInput>(
  "@sylph/domain/ProjectRequestInput"
)({
  projectId: ProjectId,
}) {}

export class ProjectDeliveryModeInput extends Schema.Class<ProjectDeliveryModeInput>(
  "@sylph/domain/ProjectDeliveryModeInput"
)({
  projectId: ProjectId,
  mode: Schema.Literals(["push", "pull_request"]),
}) {}
