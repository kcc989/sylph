import { Schema } from "effect"

import { WorkspaceId } from "./ids"
import { GitCommitId } from "./version-control"

export const WorkspaceCheckKind = Schema.Literals(["checkpoint", "production"])
export type WorkspaceCheckKind = typeof WorkspaceCheckKind.Type

export const WorkspaceCheckStatus = Schema.Literals([
  "queued",
  "running",
  "passed",
  "failed",
])
export type WorkspaceCheckStatus = typeof WorkspaceCheckStatus.Type

export const WorkspaceCheckStageName = Schema.Literals([
  "install",
  "typecheck",
  "lint",
  "test",
  "build",
  "preview",
  "browser",
  "production",
])
export type WorkspaceCheckStageName = typeof WorkspaceCheckStageName.Type

export const WorkspaceCheckStageStatus = Schema.Literals([
  "queued",
  "running",
  "passed",
  "failed",
  "skipped",
])
export type WorkspaceCheckStageStatus = typeof WorkspaceCheckStageStatus.Type

export class WorkspaceCheckStage extends Schema.Class<WorkspaceCheckStage>(
  "@sylph/domain/WorkspaceCheckStage"
)({
  name: WorkspaceCheckStageName,
  status: WorkspaceCheckStageStatus,
  detail: Schema.String,
  durationMs: Schema.NullOr(Schema.Number),
}) {}

export class WorkspaceCheckDiagnostic extends Schema.Class<WorkspaceCheckDiagnostic>(
  "@sylph/domain/WorkspaceCheckDiagnostic"
)({
  stage: WorkspaceCheckStageName,
  summary: Schema.NonEmptyString,
  output: Schema.String,
}) {}

export class WorkspaceCheckEvidence extends Schema.Class<WorkspaceCheckEvidence>(
  "@sylph/domain/WorkspaceCheckEvidence"
)({
  id: Schema.NonEmptyString,
  kind: Schema.Literals(["screenshot", "accessibility"]),
  label: Schema.NonEmptyString,
  url: Schema.NonEmptyString,
  createdAt: Schema.Number,
}) {}

export class WorkspaceCheckRun extends Schema.Class<WorkspaceCheckRun>(
  "@sylph/domain/WorkspaceCheckRun"
)({
  id: Schema.NonEmptyString,
  workspaceId: WorkspaceId,
  checkpointId: Schema.NullOr(Schema.NonEmptyString),
  commit: GitCommitId,
  kind: WorkspaceCheckKind,
  status: WorkspaceCheckStatus,
  attempt: Schema.Int,
  repairOnFailure: Schema.Boolean,
  repairStatus: Schema.Literals([
    "disabled",
    "available",
    "requested",
    "started",
  ]),
  previewUrl: Schema.NullOr(Schema.NonEmptyString),
  stages: Schema.Array(WorkspaceCheckStage),
  diagnostics: Schema.Array(WorkspaceCheckDiagnostic),
  evidence: Schema.Array(WorkspaceCheckEvidence),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

export const WorkspaceCheckRunList = Schema.Array(WorkspaceCheckRun)

export class WorkspaceCiInput extends Schema.Class<WorkspaceCiInput>(
  "@sylph/domain/WorkspaceCiInput"
)({
  provider: Schema.Literal("cloudflare-artifacts"),
  providerData: Schema.Struct({ namespace: Schema.NonEmptyString }),
  event: Schema.Struct({ type: Schema.Literals(["push", "tag"]) }),
  owner: Schema.NonEmptyString,
  repo: Schema.NonEmptyString,
  sha: GitCommitId,
  remote: Schema.optional(Schema.Literal("cloudflare")),
  trigger: Schema.Literals(["push", "tag"]),
  ref: Schema.NonEmptyString,
  branch: Schema.optional(Schema.NonEmptyString),
  tag: Schema.optional(Schema.NonEmptyString),
  beforeSha: Schema.optional(Schema.String),
  headCommitMessage: Schema.optional(Schema.String),
  actor: Schema.optional(Schema.String),
  checkRunId: Schema.NonEmptyString,
  workspaceId: WorkspaceId,
  checkpointId: Schema.NullOr(Schema.NonEmptyString),
  kind: WorkspaceCheckKind,
  attempt: Schema.Int,
  repairOnFailure: Schema.Boolean,
  createdAt: Schema.Number,
}) {}

export class WorkspaceProductionCheckInput extends Schema.Class<WorkspaceProductionCheckInput>(
  "@sylph/domain/WorkspaceProductionCheckInput"
)({
  id: Schema.NonEmptyString,
  commit: GitCommitId,
  createdAt: Schema.Number,
}) {}

export class WorkspaceCheckUpdate extends Schema.Class<WorkspaceCheckUpdate>(
  "@sylph/domain/WorkspaceCheckUpdate"
)({
  callbackId: Schema.NonEmptyString,
  run: WorkspaceCheckRun,
}) {}

export class WorkspaceRetryCheckInput extends Schema.Class<WorkspaceRetryCheckInput>(
  "@sylph/domain/WorkspaceRetryCheckInput"
)({
  workspaceId: WorkspaceId,
  runId: Schema.NonEmptyString,
  idempotencyKey: Schema.NonEmptyString,
}) {}

export class WorkspaceRepairCheckInput extends Schema.Class<WorkspaceRepairCheckInput>(
  "@sylph/domain/WorkspaceRepairCheckInput"
)({
  workspaceId: WorkspaceId,
  runId: Schema.NonEmptyString,
  idempotencyKey: Schema.NonEmptyString,
}) {}

export class WorkspaceSyncInput extends Schema.Class<WorkspaceSyncInput>(
  "@sylph/domain/WorkspaceSyncInput"
)({
  workspaceId: WorkspaceId,
}) {}

export class WorkspaceSyncResult extends Schema.Class<WorkspaceSyncResult>(
  "@sylph/domain/WorkspaceSyncResult"
)({
  status: Schema.Literals(["current", "updated", "conflicted"]),
  projectCommit: GitCommitId,
  conflictedFiles: Schema.Array(Schema.NonEmptyString),
}) {}

export class WorkspaceRunChecksToolInput extends Schema.Class<WorkspaceRunChecksToolInput>(
  "@sylph/domain/WorkspaceRunChecksToolInput"
)({
  message: Schema.optional(Schema.NonEmptyString),
  repairOnFailure: Schema.optional(Schema.Boolean),
}) {}

export class WorkspaceCheckStatusToolInput extends Schema.Class<WorkspaceCheckStatusToolInput>(
  "@sylph/domain/WorkspaceCheckStatusToolInput"
)({}) {}

export class WorkspaceSyncToolInput extends Schema.Class<WorkspaceSyncToolInput>(
  "@sylph/domain/WorkspaceSyncToolInput"
)({}) {}

const toolJsonSchema = (schema: Schema.Constraint) => {
  const document = Schema.toJsonSchemaDocument(schema)
  return { ...document.schema, $defs: document.definitions }
}

export const WorkspaceRunChecksToolJsonSchema = toolJsonSchema(
  WorkspaceRunChecksToolInput
)
export const WorkspaceCheckStatusToolJsonSchema = toolJsonSchema(
  WorkspaceCheckStatusToolInput
)
export const WorkspaceSyncToolJsonSchema = toolJsonSchema(
  WorkspaceSyncToolInput
)
export const decodeWorkspaceRunChecksToolInput = Schema.decodeUnknownPromise(
  WorkspaceRunChecksToolInput
)
export const decodeWorkspaceCheckStatusToolInput = Schema.decodeUnknownPromise(
  WorkspaceCheckStatusToolInput
)
export const decodeWorkspaceSyncToolInput = Schema.decodeUnknownPromise(
  WorkspaceSyncToolInput
)

export const decodeWorkspaceCheckRun =
  Schema.decodeUnknownSync(WorkspaceCheckRun)
export const decodeWorkspaceCheckRunList = Schema.decodeUnknownPromise(
  WorkspaceCheckRunList
)
export const encodeWorkspaceCheckRunList = Schema.encodePromise(
  WorkspaceCheckRunList
)
export const decodeWorkspaceCheckUpdatePromise =
  Schema.decodeUnknownPromise(WorkspaceCheckUpdate)
export const decodeWorkspaceCiInput = Schema.decodeUnknownSync(WorkspaceCiInput)
export const decodeWorkspaceProductionCheckInputPromise =
  Schema.decodeUnknownPromise(WorkspaceProductionCheckInput)
export const decodeWorkspaceRetryCheckInputPromise =
  Schema.decodeUnknownPromise(WorkspaceRetryCheckInput)
export const decodeWorkspaceRepairCheckInputPromise =
  Schema.decodeUnknownPromise(WorkspaceRepairCheckInput)
export const decodeWorkspaceSyncInputPromise =
  Schema.decodeUnknownPromise(WorkspaceSyncInput)
