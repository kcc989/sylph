import {
  BrowserJourneySnapshot,
  BrowserJourneyPolicy,
  BrowserPolicyException,
} from "./browser-journeys"
import { describe, expect, test } from "bun:test"
import { workspaceAcceptance } from "./acceptance"
import { WorkspaceId } from "./ids"
import { WorkspaceCheckRun } from "./checks"
import {
  GitCommitId,
  WorkspaceVersionControl,
  WorkspaceFileChange,
} from "./version-control"

const base = GitCommitId.make("a".repeat(40))
const head = GitCommitId.make("b".repeat(40))
const change = new WorkspaceFileChange({
  file: "README.md",
  status: "modified",
  additions: 1,
  deletions: 0,
  patch: "+hello",
})
const input = () => ({
  versionControl: new WorkspaceVersionControl({
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
  }),
  checks: [
    new WorkspaceCheckRun({
      id: "check",
      workspaceId: WorkspaceId.make("workspace"),
      checkpointId: "checkpoint",
      commit: head,
      kind: "checkpoint",
      status: "passed",
      attempt: 1,
      previewUrl: null,
      stages: [],
      diagnostics: [],
      evidence: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  ],
  workspaceStatus: "ready",
  reviewDecision: "approved" as const,
  reviewCommit: head,
  unresolvedComments: 0,
  turnActive: false,
  runtimeHealthy: true,
  conversationId: "conversation",
  browserProof: new BrowserJourneySnapshot({
    policy: new BrowserJourneyPolicy({
      revision: 1,
      requirements: [],
      allowedOrigins: [],
      reason: "Documentation-only change",
      actorUserId: "reviewer",
      createdAt: 1,
    }),
    binding: {
      workspaceId: WorkspaceId.make("workspace"),
      conversationId: "conversation",
      checkId: "check",
      commit: head,
      attempt: 1,
      policyRevision: 1,
    },
    results: [],
    session: null,
    exception: new BrowserPolicyException({
      binding: {
        workspaceId: WorkspaceId.make("workspace"),
        conversationId: "conversation",
        checkId: "check",
        commit: head,
        attempt: 1,
        policyRevision: 1,
      },
      actorUserId: "reviewer",
      reason: "Documentation-only change",
      createdAt: 2,
      ordinal: 1,
    }),
  }),
})

describe("Workspace Acceptance", () => {
  test("accepts an approved, checked, unchanged Checkpoint", () => {
    expect(workspaceAcceptance(input())).toEqual({
      ready: true,
      blockers: [],
      passingCheckId: "check",
    })
  })
  test("blocks a homepage-only Check without explicit journey handling", () => {
    expect(
      workspaceAcceptance({ ...input(), browserProof: undefined }).ready
    ).toBe(false)
  })
  test("a newer failed attempt cannot reuse an older passing Check", () => {
    const current = input()
    expect(
      workspaceAcceptance({
        ...current,
        checks: [
          ...current.checks,
          { ...current.checks[0], attempt: 2, status: "failed", createdAt: 2 },
        ],
      }).passingCheckId
    ).toBeNull()
  })
  test("requires an approval of the exact current commit with no unresolved comments", () => {
    const current = input()
    expect(workspaceAcceptance({ ...current, reviewCommit: base }).ready).toBe(
      false
    )
    expect(
      workspaceAcceptance({ ...current, unresolvedComments: 1 }).ready
    ).toBe(false)
    expect(
      workspaceAcceptance({ ...current, reviewDecision: "changes_requested" })
        .ready
    ).toBe(false)
  })
  test("does not accept checks from an older commit", () => {
    const current = input()
    expect(
      workspaceAcceptance({
        ...current,
        checks: current.checks.map((run) => ({ ...run, commit: base })),
      }).ready
    ).toBe(false)
  })
  test("blocks active turns, unhealthy runtimes, and read-only Workspaces", () => {
    const current = input()
    for (const override of [
      { turnActive: true },
      { runtimeHealthy: false },
      { workspaceStatus: "archived" },
      { workspaceStatus: "merging" },
    ]) {
      expect(workspaceAcceptance({ ...current, ...override }).ready).toBe(false)
    }
  })
  test("reports all blockers for dirty, empty, outdated work without passing checks", () => {
    const current = input()
    const result = workspaceAcceptance({
      ...current,
      checks: [],
      versionControl: {
        ...current.versionControl,
        working: [change],
        branch: [],
        projectChanged: true,
      },
    })
    expect(result.ready).toBe(false)
    expect(result.blockers).toHaveLength(4)
    expect(result.passingCheckId).toBeNull()
  })
})
