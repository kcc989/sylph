import { describe, expect, test } from "bun:test"
import { Database, type SQLQueryBindings } from "bun:sqlite"
import {
  GitCommitId,
  WorkspaceCheckRun,
  WorkspaceCheckUpdate,
  WorkspaceId,
} from "@workspace/domain"

import { checkStage, WorkspaceChecks } from "./workspace-checks"

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
})
