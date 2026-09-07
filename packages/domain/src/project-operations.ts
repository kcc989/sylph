import { Schema } from "effect"
import { ProjectId } from "./ids"
import { GitCommitId } from "./version-control"

export class OperationsFailure extends Schema.TaggedError<OperationsFailure>()(
  "OperationsFailure",
  { message: Schema.String }
) {}
export const IncidentAction = Schema.Struct({
  projectId: ProjectId,
  incidentId: Schema.NonEmptyString,
})
export const DeploymentIdentity = Schema.Struct({
  accountId: Schema.NonEmptyString,
  scriptName: Schema.NonEmptyString,
  deploymentId: Schema.NonEmptyString,
  versionId: Schema.NonEmptyString,
})
export type DeploymentIdentity = typeof DeploymentIdentity.Type
export const DeploymentIdentities = Schema.Array(DeploymentIdentity)
export const CloudflareDeployments = Schema.Struct({
  deployments: Schema.Array(
    Schema.Struct({
      id: Schema.NonEmptyString,
      created_on: Schema.String,
      versions: Schema.Array(
        Schema.Struct({
          version_id: Schema.NonEmptyString,
          percentage: Schema.Number,
        })
      ),
    })
  ),
})
export const TelemetryEvent = Schema.Struct({
  timestamp: Schema.Number,
  $metadata: Schema.Struct({
    id: Schema.String,
    type: Schema.optional(Schema.String),
    statusCode: Schema.optional(Schema.Number),
  }),
  $workers: Schema.optional(
    Schema.Struct({
      scriptName: Schema.String,
      requestId: Schema.String,
      outcome: Schema.optional(Schema.String),
      scriptVersion: Schema.optional(
        Schema.Struct({ id: Schema.optional(Schema.String) })
      ),
      wallTimeMs: Schema.optional(Schema.Number),
    })
  ),
})
export const TelemetryResponse = Schema.Struct({
  run: Schema.Struct({ status: Schema.Literals(["STARTED", "COMPLETED"]) }),
  events: Schema.optional(
    Schema.Struct({ events: Schema.optional(Schema.Array(TelemetryEvent)) })
  ),
})
export const HealthObservation = Schema.Struct({
  deploymentId: Schema.String,
  commit: GitCommitId,
  checkedAt: Schema.Number,
  from: Schema.Number,
  to: Schema.Number,
  status: Schema.Literals(["unknown", "observed", "degraded"]),
  detail: Schema.String,
  requests: Schema.Number,
  errors: Schema.Number,
  p95Ms: Schema.NullOr(Schema.Number),
  limited: Schema.Boolean,
  evidence: Schema.Array(
    Schema.Struct({
      requestId: Schema.String,
      versionId: Schema.String,
      scriptName: Schema.String,
      timestamp: Schema.Number,
      outcome: Schema.String,
      statusCode: Schema.NullOr(Schema.Number),
      wallTimeMs: Schema.NullOr(Schema.Number),
    })
  ),
})
export type HealthObservation = typeof HealthObservation.Type
export const ProductionTarget = Schema.Struct({
  id: Schema.String,
  commit: GitCommitId,
  identity_json: Schema.NullOr(Schema.String),
})
export const Incident = Schema.Struct({
  id: Schema.String,
  deployment_id: Schema.String,
  commit: GitCommitId,
  kind: Schema.Literals(["errors", "latency"]),
  status: Schema.Literals(["open", "acknowledged"]),
  first_seen: Schema.Number,
  last_seen: Schema.Number,
  observation_json: Schema.String,
  workspace_id: Schema.NullOr(Schema.String),
  issue_id: Schema.NullOr(Schema.String),
})
export type Incident = typeof Incident.Type

export const TelemetryQuery = Schema.Struct({
  queryId: Schema.String,
  timeframe: Schema.Struct({ from: Schema.Number, to: Schema.Number }),
  limit: Schema.Number,
  dry: Schema.Boolean,
  view: Schema.Literal("events"),
  parameters: Schema.Struct({
    filters: Schema.Array(
      Schema.Struct({
        key: Schema.String,
        operation: Schema.Literal("eq"),
        type: Schema.Literal("string"),
        value: Schema.String,
      })
    ),
  }),
})
export type TelemetryQuery = typeof TelemetryQuery.Type
