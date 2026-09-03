import { Schema } from "effect"

export const ProjectId = Schema.NonEmptyString.pipe(Schema.brand("ProjectId"))
export type ProjectId = typeof ProjectId.Type

export const OrganizationId = Schema.NonEmptyString.pipe(
  Schema.brand("OrganizationId")
)
export type OrganizationId = typeof OrganizationId.Type

export const WorkspaceId = Schema.NonEmptyString.pipe(
  Schema.brand("WorkspaceId")
)
export type WorkspaceId = typeof WorkspaceId.Type

export const IssueId = Schema.NonEmptyString.pipe(Schema.brand("IssueId"))
export type IssueId = typeof IssueId.Type

export const AgentSessionId = Schema.NonEmptyString.pipe(
  Schema.brand("AgentSessionId")
)
export type AgentSessionId = typeof AgentSessionId.Type
