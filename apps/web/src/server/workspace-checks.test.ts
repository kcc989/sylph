import { describe, expect, test } from "bun:test"
import { Database, type SQLQueryBindings } from "bun:sqlite"
import {
  GitCommitId,
  WorkspaceCheckRun,
  WorkspaceCheckUpdate,
  WorkspaceId,
} from "@workspace/domain"

import {
  automaticRepairIdempotencyKey,
  checkStage,
  maxWorkspaceAutomaticRepairs,
  maxWorkspaceCheckAttempts,
  maxWorkspaceRepairAttempts,
  WorkspaceChecks,
  WorkspaceRepairLimitReached,
} from "./workspace-checks"

class TestSqlStorage {
  readonly #database = new Database(":memory:")
  readonly sql = {
    exec: <Row extends Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: SqlStorageValue[]
    ) => {
      const parameters: SQLQueryBindings[] = bindings.map((binding) =>
        binding instanceof ArrayBuffer ? new Uint8Array(binding) : binding
      )
      const rows = this.#database
        .query<Row, SQLQueryBindings[]>(query)
        .all(...parameters)
      return { toArray: () => rows }
    },
  }
}

const run = () =>
  new WorkspaceCheckRun({
    id: "check-1",
    workspaceId: WorkspaceId.make("workspace-1"),
    checkpointId: "checkpoint-1",
    commit: GitCommitId.make("1234567890123456789012345678901234567890"),
    kind: "checkpoint",
    status: "queued",
    attempt: 1,
    repairOnFailure: true,
    repairStatus: "available",
    previewUrl: null,
    stages: [checkStage("install", "queued", "Waiting")],
    diagnostics: [],
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
  })

describe("WorkspaceChecks", () => {
  test("keeps the newer Check first when an older Check finishes later", () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    checks.create(run())
    const newer = new WorkspaceCheckRun({
      ...run(),
      id: "check-2",
      createdAt: 2,
      updatedAt: 2,
      status: "running",
    })
    checks.create(newer)
    checks.apply(
      new WorkspaceCheckUpdate({
        callbackId: "check-1:failed:1",
        run: new WorkspaceCheckRun({
          ...run(),
          status: "failed",
          updatedAt: 3,
        }),
      })
    )

    expect(checks.list().map((check) => check.id)).toEqual([
      "check-2",
      "check-1",
    ])
    expect(checks.list()[0]).toEqual(newer)
    expect(checks.get("check-1")?.status).toBe("failed")
  })

  test("applies callbacks once and preserves the structured run", () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    checks.create(run())
    const passed = new WorkspaceCheckRun({
      ...run(),
      status: "passed",
      stages: [checkStage("install", "passed", "Complete", 12)],
      updatedAt: 2,
    })
    const update = new WorkspaceCheckUpdate({
      callbackId: "check-1:install:1",
      run: passed,
    })

    expect(checks.apply(update)).toBeTrue()
    expect(checks.apply(update)).toBeFalse()
    expect(checks.get("check-1")).toEqual(passed)
    expect(checks.latestPassingCheckpoint(passed.commit)?.id).toBe("check-1")
  })

  test("makes retries and repair turns idempotent", () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    checks.create(
      new WorkspaceCheckRun({
        ...run(),
        status: "failed",
        repairOnFailure: false,
        repairStatus: "available",
      })
    )

    const repaired = checks.requestRepair("check-1", "repair-key")
    expect(checks.requestRepair("check-1", "repair-key")).toEqual(repaired)
    expect(checks.takeRepair("check-1")?.repairStatus).toBe("started")
    expect(checks.takeRepair("check-1")).toBeNull()

    const retried = checks.retry("check-1", "retry-key")
    expect(retried.attempt).toBe(2)
    expect(checks.retry("check-1", "retry-key")).toEqual(retried)
  })

  test("enforces visible retry and repair limits", () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    checks.create(
      new WorkspaceCheckRun({
        ...run(),
        status: "failed",
        attempt: maxWorkspaceCheckAttempts,
        repairOnFailure: false,
      })
    )

    expect(() => checks.retry("check-1", "retry-over-limit")).toThrow(
      `${maxWorkspaceCheckAttempts}-attempt limit`
    )

    for (let attempt = 1; attempt <= maxWorkspaceRepairAttempts; attempt += 1) {
      checks.requestRepair("check-1", `repair-${attempt}`)
      checks.takeRepair("check-1")
      checks.apply(
        new WorkspaceCheckUpdate({
          callbackId: `repair-reset-${attempt}`,
          run: new WorkspaceCheckRun({
            ...checks.get("check-1")!,
            repairStatus: "available",
          }),
        })
      )
    }

    expect(() => checks.requestRepair("check-1", "repair-over-limit")).toThrow(
      `${maxWorkspaceRepairAttempts}-repair limit`
    )
  })

  test("bounds automatic repair across every Check in the Workspace", () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    const failedRun = (id: string) =>
      new WorkspaceCheckRun({
        ...run(),
        id,
        checkpointId: id,
        status: "failed",
        repairOnFailure: true,
        repairStatus: "available",
      })

    for (let index = 1; index <= maxWorkspaceAutomaticRepairs; index += 1) {
      const id = `check-${index}`
      checks.create(failedRun(id))
      checks.requestRepair(id, automaticRepairIdempotencyKey(id), "automatic")
      expect(checks.takeRepair(id)?.repairStatus).toBe("started")
    }
    expect(checks.automaticRepairsUsed()).toBe(maxWorkspaceAutomaticRepairs)

    const exhausted = "check-exhausted"
    checks.create(failedRun(exhausted))
    expect(() =>
      checks.requestRepair(
        exhausted,
        automaticRepairIdempotencyKey(exhausted),
        "automatic"
      )
    ).toThrow(WorkspaceRepairLimitReached)
    expect(checks.get(exhausted)?.repairStatus).toBe("available")

    checks.requestRepair(exhausted, "manual-key")
    expect(checks.automaticRepairsUsed()).toBe(maxWorkspaceAutomaticRepairs)
    expect(checks.get(exhausted)?.repairStatus).toBe("requested")
  })

  test("a user prompt or a passing Check restores the automatic repair budget", () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    checks.create(
      new WorkspaceCheckRun({
        ...run(),
        status: "failed",
        repairOnFailure: true,
      })
    )
    checks.requestRepair(
      "check-1",
      automaticRepairIdempotencyKey("check-1"),
      "automatic"
    )
    expect(checks.automaticRepairsUsed()).toBe(1)

    checks.resetAutomaticRepairs("prompt:1")
    expect(checks.automaticRepairsUsed()).toBe(0)

    checks.create(
      new WorkspaceCheckRun({ ...run(), id: "check-2", status: "failed" })
    )
    checks.requestRepair(
      "check-2",
      automaticRepairIdempotencyKey("check-2"),
      "automatic"
    )
    expect(checks.automaticRepairsUsed()).toBe(1)
    checks.apply(
      new WorkspaceCheckUpdate({
        callbackId: "check-2:1:run-passed",
        run: new WorkspaceCheckRun({
          ...run(),
          id: "check-2",
          status: "passed",
        }),
      })
    )
    expect(checks.automaticRepairsUsed()).toBe(0)
  })

  test("keeps repair notices and agent evidence on the durable run", () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    checks.create(new WorkspaceCheckRun({ ...run(), status: "failed" }))

    checks.recordRepairNotice("check-1", "Automatic repair reached its limit")
    checks.apply(
      new WorkspaceCheckUpdate({
        callbackId: "late-callback",
        run: new WorkspaceCheckRun({ ...run(), status: "failed" }),
      })
    )
    expect(checks.get("check-1")?.repairNotice).toBe(
      "Automatic repair reached its limit"
    )

    const updated = checks.addEvidence("check-1", [
      {
        id: "check-1-agent-screenshot-1",
        kind: "screenshot",
        label: "Agent browser /",
        url: "/api/workspaces/workspace-1/evidence/check-1-agent-screenshot-1",
        createdAt: 5,
      },
    ])
    expect(updated.evidence).toHaveLength(1)
    expect(checks.get("check-1")?.evidence[0]?.label).toBe("Agent browser /")
  })
})
