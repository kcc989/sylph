import { describe, expect, test } from "bun:test"
import {
  GitCommitId,
  WorkspaceCheckRun,
  WorkspaceFileChange,
  WorkspaceId,
  WorkspaceVersionControl,
} from "@workspace/domain"

import {
  reviewDecisionFromRow,
  workspaceMergeRequest,
} from "./workspace-merge-request"

const base = GitCommitId.make("a".repeat(40))
const head = GitCommitId.make("b".repeat(40))
const change = new WorkspaceFileChange({
  file: "README.md",
  status: "modified",
  additions: 1,
  deletions: 0,
  patch: "diff --git a/README.md b/README.md\n+hello",
})

const versionControl = (input: Partial<WorkspaceVersionControl> = {}) =>
  new WorkspaceVersionControl({
    defaultRef: "main",
    currentRef: "main",
    baseCommit: base,
    forkHead: head,
    projectHead: base,
    projectChanged: false,
    syncStatus: "ready",
    mergeStatus: "ready",
    working: [],
    branch: [change],
    ...input,
  })

const passing = new WorkspaceCheckRun({
  id: "check-1",
  workspaceId: WorkspaceId.make("workspace-1"),
  checkpointId: "checkpoint-1",
  commit: head,
  kind: "checkpoint",
  status: "passed",
  attempt: 1,
  repairOnFailure: false,
  repairStatus: "disabled",
  previewUrl: "https://preview.example.workers.dev",
  stages: [],
  diagnostics: [],
  evidence: [],
  createdAt: 1,
  updatedAt: 1,
})

describe("Merge request readiness", () => {
  test("is ready when the reviewed Checkpoint passed and nothing is pending", () => {
    const request = workspaceMergeRequest({
      versionControl: versionControl(),
      checks: [passing],
      workspaceStatus: "ready",
      reviewDecision: "approved",
      unresolvedComments: 0,
      turnActive: false,
    })
    expect(request.ready).toBeTrue()
    expect(request.blockers).toEqual([])
    expect(request.passingCheckId).toBe("check-1")
  })

  test("lists every blocker instead of the first one", () => {
    const request = workspaceMergeRequest({
      versionControl: versionControl({
        working: [change],
        projectChanged: true,
      }),
      checks: [],
      workspaceStatus: "ready",
      reviewDecision: "changes_requested",
      unresolvedComments: 2,
      turnActive: true,
    })
    expect(request.ready).toBeFalse()
    expect(request.blockers).toEqual([
      "An agent Turn is still running.",
      "1 Working copy change(s) are not in a Checkpoint.",
      "The latest Checkpoint has not passed its Check, Preview, and browser verification.",
      "The Project Repository advanced. Update the Workspace and run a new Check.",
      "The review is changes requested; a User must approve it.",
      "2 review comment(s) are unresolved.",
    ])
  })

  test("normalizes unknown review rows to pending", () => {
    expect(reviewDecisionFromRow(undefined)).toBe("pending")
    expect(reviewDecisionFromRow("approved")).toBe("approved")
    expect(reviewDecisionFromRow("weird")).toBe("pending")
  })
})
