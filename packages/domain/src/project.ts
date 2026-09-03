import { Schema } from "effect"

import { OrganizationId, ProjectId } from "./ids"

export class CreateProjectInput extends Schema.Class<CreateProjectInput>(
  "@sylph/domain/CreateProjectInput"
)({
  organizationId: OrganizationId,
  name: Schema.NonEmptyString,
  sourceRepositoryUrl: Schema.optional(Schema.NonEmptyString),
  sourceBranch: Schema.optional(Schema.NonEmptyString),
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
