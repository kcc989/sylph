export { LifecycleActionOptions } from "./lifecycle-proof"

import { Schema } from "effect"
import { CiRunSummary } from "./checks"
import {
  DeployedSmokeIdentity,
  LifecycleCommit,
  LifecyclePath,
} from "./lifecycle-proof"
import { DeploymentRecoveryPoint } from "./deployments"

export const LifecycleWorkspaceRow = Schema.Struct({
  id: Schema.NonEmptyString,
  project_id: Schema.NonEmptyString,
  status: Schema.NonEmptyString,
  fork_head: Schema.NullOr(LifecycleCommit),
  accepted_commit: Schema.NullOr(LifecycleCommit),
})
export const LifecycleProjectRow = Schema.Struct({
  id: Schema.NonEmptyString,
  slug: Schema.NonEmptyString,
  template_commit: LifecycleCommit,
})
export const LifecycleOwnerRow = Schema.Struct({
  id: Schema.NonEmptyString,
  organization_id: Schema.NonEmptyString,
  claimed_by_user_id: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
})
export const LifecycleCheckRow = Schema.Struct({
  id: Schema.NonEmptyString,
  workspace_id: Schema.NonEmptyString,
  workflow_instance_id: Schema.NonEmptyString,
  commit_sha: LifecycleCommit,
  status: Schema.NonEmptyString,
  summary_json: Schema.NullOr(Schema.String),
})
export const LifecycleDeploymentRow = Schema.Struct({
  id: Schema.NonEmptyString,
  commit: LifecycleCommit,
  status: Schema.NonEmptyString,
  production_url: Schema.NullOr(Schema.String),
  failure_details: Schema.NullOr(Schema.String),
  recovery_deployment_id: Schema.NullOr(Schema.String),
  recovery_json: Schema.NullOr(Schema.String),
  verification_json: Schema.NullOr(Schema.String),
  restore_json: Schema.NullOr(Schema.String),
})
export type LifecycleDeploymentRow = typeof LifecycleDeploymentRow.Type
export const LifecyclePreview = Schema.Struct({
  check: LifecycleCheckRow,
  summary: CiRunSummary,
  worker: Schema.NonEmptyString,
  databaseId: Schema.NonEmptyString,
  controlDatabaseId: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
})
export type LifecyclePreview = typeof LifecyclePreview.Type
export const LifecycleActionState = Schema.Struct({
  identity: DeployedSmokeIdentity,
  installationDatabaseId: Schema.NonEmptyString,
  workflowName: Schema.NonEmptyString,
  owner: Schema.optional(LifecycleOwnerRow),
  project: Schema.optional(LifecycleProjectRow),
  workspace: Schema.optional(LifecycleWorkspaceRow),
  workspaceUrl: Schema.optional(Schema.String),
  previews: Schema.Array(LifecyclePreview),
  deployments: Schema.Array(LifecycleDeploymentRow),
  recovery: Schema.optional(DeploymentRecoveryPoint),
  productionDatabaseId: Schema.optional(Schema.String),
  productionWorker: Schema.optional(Schema.String),
  marker: Schema.NonEmptyString,
})
export type LifecycleActionState = typeof LifecycleActionState.Type
export const LifecycleSession = Schema.Struct({
  user: Schema.Struct({
    id: Schema.NonEmptyString,
    email: Schema.NonEmptyString,
  }),
})
export const LifecycleWorkflowResponse = Schema.Struct({
  success: Schema.Literal(true),
  result: Schema.Struct({ status: Schema.NonEmptyString }),
})
export const LifecycleRecoveryExport = Schema.Struct({
  repositories: Schema.Array(
    Schema.Struct({ kind: Schema.String, headCommit: LifecycleCommit })
  ),
})
export const LifecycleAssertion = Schema.Struct({
  name: Schema.NonEmptyString,
  expected: Schema.Json,
  observed: Schema.Json,
})
export type LifecycleAssertion = typeof LifecycleAssertion.Type
export const LifecycleProviderEvidence = Schema.Struct({
  identity: DeployedSmokeIdentity,
  path: LifecyclePath,
  requests: Schema.Array(
    Schema.Struct({
      path: Schema.NonEmptyString,
      select: Schema.optional(Schema.String),
      params: Schema.optional(Schema.Array(Schema.Json)),
      status: Schema.Int,
      body: Schema.Json,
    })
  ).check(Schema.isMinLength(1)),
  assertions: Schema.Array(LifecycleAssertion).check(Schema.isMinLength(1)),
})
export type LifecycleProviderEvidence = typeof LifecycleProviderEvidence.Type
export class LifecycleActionBlocked extends Schema.TaggedError<LifecycleActionBlocked>()(
  "LifecycleActionBlocked",
  {
    message: Schema.String,
  }
) {}

export const LifecycleWireObject = Schema.Struct({
  t: Schema.Literal(10),
  p: Schema.Struct({
    k: Schema.Array(Schema.String),
    v: Schema.Array(Schema.Json),
  }),
})
export const LifecycleReleaseEnvelope = Schema.Struct({
  t: LifecycleWireObject,
})
export const LifecycleWireScalar = Schema.Union([
  Schema.Struct({ t: Schema.Literal(1), s: Schema.String }),
  Schema.Struct({ t: Schema.Literal(2), s: Schema.Literals([1, 2, 3]) }),
])
