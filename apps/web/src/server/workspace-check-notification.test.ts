import { describe, expect, test } from "bun:test"
import {
  GitCommitId,
  WorkspaceCheckDiagnostic,
  WorkspaceCheckEvidence,
  WorkspaceCheckRun,
  WorkspaceId,
} from "@workspace/domain"

import { checkStage } from "./workspace-checks"
import {
  checkFailedNotification,
  checkPassedNotification,
  checkRepairPrompt,
  isTerminalCheckStatus,
  repairDisabledReason,
} from "./workspace-check-notification"

const commit = GitCommitId.make("1234567890123456789012345678901234567890")

const run = (status: WorkspaceCheckRun["status"]) =>
  new WorkspaceCheckRun({
    id: "check-1",
    workspaceId: WorkspaceId.make("workspace-1"),
    checkpointId: "checkpoint-1",
    commit,
    kind: "checkpoint",
    status,
    attempt: 2,
    repairOnFailure: false,
    repairStatus: "available",
    previewUrl:
      status === "passed" ? "https://preview.example.workers.dev" : null,
    stages: [
      checkStage("install", "passed", "Passed", 1500),
      checkStage("test", status === "failed" ? "failed" : "passed", "Done"),
    ],
    diagnostics:
      status === "failed"
        ? [
            new WorkspaceCheckDiagnostic({
              stage: "test",
              summary: "test failed",
              output: "expected 1 to be 2",
            }),
          ]
        : [],
    evidence:
      status === "passed"
        ? [
            new WorkspaceCheckEvidence({
              id: "shot",
              kind: "screenshot",
              label: "Desktop screenshot",
              url: "/api/workspaces/workspace-1/evidence/shot",
              createdAt: 1,
            }),
          ]
        : [],
    createdAt: 1,
    updatedAt: 2,
  })

describe("Check notifications", () => {
  test("only terminal statuses notify the agent", () => {
    expect(isTerminalCheckStatus("queued")).toBeFalse()
    expect(isTerminalCheckStatus("running")).toBeFalse()
    expect(isTerminalCheckStatus("passed")).toBeTrue()
    expect(isTerminalCheckStatus("failed")).toBeTrue()
  })

  test("a passing Check hands the agent the Preview and evidence", () => {
    const text = checkPassedNotification(run("passed"))
    expect(text).toContain("Check check-1 passed for Checkpoint 1234567")
    expect(text).toContain("install passed (1.5s)")
    expect(text).toContain("https://preview.example.workers.dev")
    expect(text).toContain("Desktop screenshot")
    expect(text).toContain("Do not run Workspace checks again")
  })

  test("a failing Check without repair explains and waits for direction", () => {
    const text = checkFailedNotification(run("failed"), {
      reason: repairDisabledReason,
    })
    expect(text).toContain("Check check-1 failed")
    expect(text).toContain(repairDisabledReason)
    expect(text).toContain("wait for direction before changing files")
    expect(text).toContain("test: test failed\nexpected 1 to be 2")
  })

  test("the repair prompt keeps validation strict and carries diagnostics", () => {
    const text = checkRepairPrompt(run("failed"))
    expect(text).toContain("without weakening validation")
    expect(text).toContain("expected 1 to be 2")
  })
})
