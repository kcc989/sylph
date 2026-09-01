import { Schema } from "effect"

import { ProjectId, WorkspaceId } from "./ids"
import { WorkspaceReviewDecision } from "./review"
import { GitCommitId, WorkspaceFileChange } from "./version-control"

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
  maxAttempts: Schema.optional(Schema.Int),
  repairAttempt: Schema.optional(Schema.Int),
  maxRepairAttempts: Schema.optional(Schema.Int),
  repairNotice: Schema.optional(Schema.String),
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
  projectId: ProjectId,
  workspaceId: WorkspaceId,
  agentSessionId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  checkpointId: Schema.NullOr(Schema.NonEmptyString),
  kind: WorkspaceCheckKind,
  attempt: Schema.Int,
  repairOnFailure: Schema.Boolean,
  deploymentId: Schema.NullOr(Schema.NonEmptyString),
  createdAt: Schema.Number,
}) {}

export class CiRunSummary extends Schema.Class<CiRunSummary>(
  "@sylph/domain/CiRunSummary"
)({
  attempt: Schema.Int,
  stages: Schema.Array(
    Schema.Struct({
      name: WorkspaceCheckStageName,
      status: WorkspaceCheckStageStatus,
      durationMs: Schema.NullOr(Schema.Number),
    })
  ),
  diagnostics: Schema.Array(
    Schema.Struct({ stage: WorkspaceCheckStageName, summary: Schema.String })
  ),
  previewUrl: Schema.NullOr(Schema.NonEmptyString),
  evidenceCount: Schema.Int,
}) {}

export const CiRunStatus = Schema.Literals([
  "queued",
  "running",
  "passed",
  "failed",
  "cancelled",
])
export type CiRunStatus = typeof CiRunStatus.Type

export class CiRunRecord extends Schema.Class<CiRunRecord>(
  "@sylph/domain/CiRunRecord"
)({
  id: Schema.NonEmptyString,
  projectId: ProjectId,
  workspaceId: WorkspaceId,
  workspaceTitle: Schema.String,
  commit: GitCommitId,
  kind: WorkspaceCheckKind,
  status: CiRunStatus,
  summary: Schema.NullOr(CiRunSummary),
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
}) {}

export const CiRunRecordList = Schema.Array(CiRunRecord)

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

export class WorkspaceCheckpointToolInput extends Schema.Class<WorkspaceCheckpointToolInput>(
  "@sylph/domain/WorkspaceCheckpointToolInput"
)({
  message: Schema.optional(Schema.NonEmptyString),
}) {}

export const WorkspaceDiffScope = Schema.Literals(["working", "checkpoint"])
export type WorkspaceDiffScope = typeof WorkspaceDiffScope.Type

export class WorkspaceDiffToolInput extends Schema.Class<WorkspaceDiffToolInput>(
  "@sylph/domain/WorkspaceDiffToolInput"
)({
  scope: Schema.optional(WorkspaceDiffScope),
}) {}

export class WorkspaceDiffResult extends Schema.Class<WorkspaceDiffResult>(
  "@sylph/domain/WorkspaceDiffResult"
)({
  scope: WorkspaceDiffScope,
  baseCommit: GitCommitId,
  forkHead: GitCommitId,
  files: Schema.Array(WorkspaceFileChange),
  truncated: Schema.Boolean,
}) {}

export class WorkspaceMergeToolInput extends Schema.Class<WorkspaceMergeToolInput>(
  "@sylph/domain/WorkspaceMergeToolInput"
)({}) {}

export class WorkspaceMergeRequest extends Schema.Class<WorkspaceMergeRequest>(
  "@sylph/domain/WorkspaceMergeRequest"
)({
  ready: Schema.Boolean,
  blockers: Schema.Array(Schema.NonEmptyString),
  baseCommit: GitCommitId,
  forkHead: GitCommitId,
  projectHead: GitCommitId,
  passingCheckId: Schema.NullOr(Schema.NonEmptyString),
  reviewDecision: WorkspaceReviewDecision,
  unresolvedComments: Schema.Int,
  instructions: Schema.NonEmptyString,
}) {}

export class WorkspacePreviewToolInput extends Schema.Class<WorkspacePreviewToolInput>(
  "@sylph/domain/WorkspacePreviewToolInput"
)({}) {}

export class WorkspacePreviewResult extends Schema.Class<WorkspacePreviewResult>(
  "@sylph/domain/WorkspacePreviewResult"
)({
  status: Schema.Literals(["ready", "pending", "failed"]),
  commit: GitCommitId,
  checkId: Schema.NullOr(Schema.NonEmptyString),
  previewUrl: Schema.NullOr(Schema.NonEmptyString),
  evidence: Schema.Array(WorkspaceCheckEvidence),
  detail: Schema.NonEmptyString,
}) {}

export class WorkspaceProductionToolInput extends Schema.Class<WorkspaceProductionToolInput>(
  "@sylph/domain/WorkspaceProductionToolInput"
)({}) {}

export class WorkspaceProductionDeployment extends Schema.Class<WorkspaceProductionDeployment>(
  "@sylph/domain/WorkspaceProductionDeployment"
)({
  id: Schema.NonEmptyString,
  commit: GitCommitId,
  status: Schema.NonEmptyString,
  productionUrl: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
}) {}

export class WorkspaceProductionStatus extends Schema.Class<WorkspaceProductionStatus>(
  "@sylph/domain/WorkspaceProductionStatus"
)({
  acceptedCommits: Schema.Array(GitCommitId),
  deployments: Schema.Array(WorkspaceProductionDeployment),
  instructions: Schema.NonEmptyString,
}) {}

export class WorkspaceBrowserToolInput extends Schema.Class<WorkspaceBrowserToolInput>(
  "@sylph/domain/WorkspaceBrowserToolInput"
)({
  path: Schema.optional(Schema.String),
  url: Schema.optional(Schema.NonEmptyString),
  fullPage: Schema.optional(Schema.Boolean),
}) {}

export class WorkspaceBrowserResult extends Schema.Class<WorkspaceBrowserResult>(
  "@sylph/domain/WorkspaceBrowserResult"
)({
  url: Schema.NonEmptyString,
  checkId: Schema.NonEmptyString,
  markdown: Schema.String,
  accessibility: Schema.String,
  evidence: Schema.Array(WorkspaceCheckEvidence),
}) {}

export class WorkspaceArchiveInput extends Schema.Class<WorkspaceArchiveInput>(
  "@sylph/domain/WorkspaceArchiveInput"
)({
  workspaceId: WorkspaceId,
}) {}

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
export const WorkspaceCheckpointToolJsonSchema = toolJsonSchema(
  WorkspaceCheckpointToolInput
)
export const WorkspaceDiffToolJsonSchema = toolJsonSchema(
  WorkspaceDiffToolInput
)
export const WorkspaceMergeToolJsonSchema = toolJsonSchema(
  WorkspaceMergeToolInput
)
export const WorkspacePreviewToolJsonSchema = toolJsonSchema(
  WorkspacePreviewToolInput
)
export const WorkspaceProductionToolJsonSchema = toolJsonSchema(
  WorkspaceProductionToolInput
)
export const WorkspaceBrowserToolJsonSchema = toolJsonSchema(
  WorkspaceBrowserToolInput
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
export const decodeWorkspaceCheckpointToolInput = Schema.decodeUnknownPromise(
  WorkspaceCheckpointToolInput
)
export const decodeWorkspaceDiffToolInput = Schema.decodeUnknownPromise(
  WorkspaceDiffToolInput
)
export const decodeWorkspaceMergeToolInput = Schema.decodeUnknownPromise(
  WorkspaceMergeToolInput
)
export const decodeWorkspacePreviewToolInput = Schema.decodeUnknownPromise(
  WorkspacePreviewToolInput
)
export const decodeWorkspaceProductionToolInput = Schema.decodeUnknownPromise(
  WorkspaceProductionToolInput
)
export const decodeWorkspaceBrowserToolInput = Schema.decodeUnknownPromise(
  WorkspaceBrowserToolInput
)
export const decodeWorkspaceArchiveInputPromise = Schema.decodeUnknownPromise(
  WorkspaceArchiveInput
)
export const decodeCiRunSummary = Schema.decodeUnknownSync(CiRunSummary)
export const encodeCiRunSummary = Schema.encodeSync(CiRunSummary)
export const decodeCiRunRecordList =
  Schema.decodeUnknownPromise(CiRunRecordList)
export const encodeCiRunRecordList = Schema.encodePromise(CiRunRecordList)

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
