import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import {
  GitCommitId,
  WorkspaceCheckDiagnostic,
  WorkspaceCheckRun,
  WorkspaceId,
} from "@workspace/domain"

import {
  ciRunSummary,
  ciRunUpsertBindings,
  ciRunUpsertSql,
} from "./ci-run-records"
import { checkStage } from "./workspace-checks"

const run = (status: WorkspaceCheckRun["status"]) =>
  new WorkspaceCheckRun({
    id: "check-1",
    workspaceId: WorkspaceId.make("workspace-1"),
    checkpointId: "checkpoint-1",
    commit: GitCommitId.make("1".repeat(40)),
    kind: "checkpoint",
    status,
    attempt: 1,
    repairOnFailure: false,
    repairStatus: "disabled",
    previewUrl: null,
    stages: [checkStage("install", "passed", "Passed", 100)],
    diagnostics:
      status === "failed"
        ? [
            new WorkspaceCheckDiagnostic({
              stage: "install",
              summary: "x".repeat(300),
              output: "long output",
            }),
          ]
        : [],
    evidence: [],
    createdAt: 10_000,
    updatedAt: status === "queued" ? 10_000 : 25_000,
  })

const database = () => {
  const store = new Database(":memory:")
  store.exec(
    "CREATE TABLE ci_runs (id TEXT PRIMARY KEY, project_id TEXT, workspace_id TEXT, agent_session_id TEXT, workflow_instance_id TEXT, commit_sha TEXT, kind TEXT, status TEXT, summary_json TEXT, started_at INTEGER, finished_at INTEGER, created_at INTEGER, updated_at INTEGER)"
  )
  return store
}

describe("CI run records", () => {
  test("keeps the D1 summary small and redacted", () => {
    const summary = ciRunSummary(run("failed"))
    expect(summary.diagnostics[0]?.summary).toHaveLength(200)
    expect(summary.stages).toEqual([
      { name: "install", status: "passed", durationMs: 100 },
    ])
  })

  test("upserts each publish while preserving the first start time", () => {
    const store = database()
    const upsert = (status: WorkspaceCheckRun["status"]) =>
      store.query(ciRunUpsertSql).run(
        ...ciRunUpsertBindings({
          run: run(status),
          projectId: "project-1",
          agentSessionId: "session-1",
          workflowInstanceId: "check-1-attempt-1",
        })
      )
    upsert("queued")
    upsert("running")
    upsert("passed")

    expect(
      store
        .query(
          "SELECT status, started_at AS startedAt, finished_at AS finishedAt, agent_session_id AS agentSessionId, created_at AS createdAt FROM ci_runs WHERE id = ?"
        )
        .get("check-1")
    ).toEqual({
      status: "passed",
      startedAt: 25,
      finishedAt: 25,
      agentSessionId: "session-1",
      createdAt: 10,
    })
    expect(store.query("SELECT COUNT(*) AS value FROM ci_runs").get()).toEqual({
      value: 1,
    })
  })
})
