import { Schema } from "effect"

export const ProjectId = Schema.NonEmptyString.pipe(Schema.brand("ProjectId"))
export type ProjectId = typeof ProjectId.Type

export const WorkspaceId = Schema.NonEmptyString.pipe(
  Schema.brand("WorkspaceId")
)
export type WorkspaceId = typeof WorkspaceId.Type

export const AgentSessionId = Schema.NonEmptyString.pipe(
  Schema.brand("AgentSessionId")
)
export type AgentSessionId = typeof AgentSessionId.Type
