import {
  CiRunSummary,
  encodeCiRunSummary,
  type CiRunStatus,
  type WorkspaceCheckRun,
} from "@workspace/domain"

export const ciRunUpsertSql =
  "INSERT INTO ci_runs (id, project_id, workspace_id, agent_session_id, workflow_instance_id, commit_sha, kind, status, summary_json, started_at, finished_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch()) ON CONFLICT(id) DO UPDATE SET status = excluded.status, summary_json = excluded.summary_json, workflow_instance_id = excluded.workflow_instance_id, agent_session_id = COALESCE(excluded.agent_session_id, ci_runs.agent_session_id), started_at = COALESCE(ci_runs.started_at, excluded.started_at), finished_at = excluded.finished_at, updated_at = unixepoch()"

export const ciRunStatus = (run: WorkspaceCheckRun): CiRunStatus => run.status

export const ciRunSummary = (run: WorkspaceCheckRun) =>
  new CiRunSummary({
    attempt: run.attempt,
    stages: run.stages.map((stage) => ({
      name: stage.name,
      status: stage.status,
      durationMs: stage.durationMs,
    })),
    diagnostics: run.diagnostics.map((diagnostic) => ({
      stage: diagnostic.stage,
      summary: diagnostic.summary.slice(0, 200),
    })),
    previewUrl: run.previewUrl,
    evidenceCount: run.evidence.length,
  })

const seconds = (milliseconds: number) => Math.floor(milliseconds / 1000)

export const ciRunUpsertBindings = (input: {
  run: WorkspaceCheckRun
  projectId: string
  agentSessionId: string | null
  workflowInstanceId: string
}): [
  string,
  string,
  string,
  string | null,
  string,
  string,
  string,
  string,
  string,
  number | null,
  number | null,
  number,
] => {
  const { run } = input
  const terminal = run.status === "passed" || run.status === "failed"
  return [
    run.id,
    input.projectId,
    run.workspaceId,
    input.agentSessionId,
    input.workflowInstanceId,
    run.commit,
    run.kind,
    ciRunStatus(run),
    JSON.stringify(encodeCiRunSummary(ciRunSummary(run))),
    run.status === "queued" ? null : seconds(run.updatedAt),
    terminal ? seconds(run.updatedAt) : null,
    seconds(run.createdAt),
  ]
}
