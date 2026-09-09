import { describe, expect, test } from "bun:test"
import { Database, type SQLQueryBindings } from "bun:sqlite"
import {
  GitCommitId,
  WorkspaceCheckRun,
  WorkspaceCheckUpdate,
  WorkspaceId,
} from "@workspace/domain"

import { checkStage, newCheckRun, WorkspaceChecks } from "./workspace-checks"

class TestSqlStorage {
  readonly #database = new Database(":memory:")
  failCallback = false

  transactionSync<T>(callback: () => T): T {
    return this.#database.transaction(callback)()
  }
  readonly sql = {
    exec: <Row extends Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: SqlStorageValue[]
    ) => {
      if (
        this.failCallback &&
        query.startsWith("INSERT INTO app_workspace_check_callback")
      ) {
        this.failCallback = false
        throw new Error("Callback storage failed")
      }
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
    autoRepair: true,
    status: "queued",
    attempt: 1,
    previewUrl: null,
    stages: [checkStage("install", "queued", "Waiting")],
    diagnostics: [],
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
  })

describe("WorkspaceChecks", () => {
  test("keeps legacy dependency results readable but rejects new retries", () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    const legacy = new WorkspaceCheckRun({
      ...run(),
      kind: "dependencies",
      status: "failed",
    })
    checks.create(legacy)
    expect(checks.get(legacy.id)?.kind).toBe("dependencies")
    expect(() => checks.retry(legacy.id, "retry-legacy")).toThrow("retired")
    expect(checks.get(legacy.id)?.attempt).toBe(legacy.attempt)
  })

  test("a successful dependency repair cannot authorize Acceptance", () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    const repaired = new WorkspaceCheckRun({
      ...run(),
      kind: "dependencies",
      status: "passed",
    })
    checks.create(repaired)
    expect(checks.latestPassingCheckpoint(repaired.commit)).toBeNull()
  })
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

  test("makes retries idempotent and limits attempts", () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    checks.create(run())
    const retried = checks.retry("check-1", "retry-key")
    expect(retried.attempt).toBe(2)
    expect(checks.retry("check-1", "retry-key")).toEqual(retried)
    checks.retry("check-1", "retry-2")
    expect(() => checks.retry("check-1", "retry-3")).toThrow("attempt limit")
  })

  test("keeps agent evidence on the durable run", () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    checks.create(run())
    checks.addEvidence("check-1", [
      {
        id: "shot",
        kind: "screenshot",
        label: "Preview",
        url: "/shot",
        createdAt: 5,
      },
    ])
    expect(checks.get("check-1")?.evidence).toHaveLength(1)
  })
})

const finish = (
  checks: WorkspaceChecks,
  id: string,
  status: "passed" | "failed" = "failed",
  attempt = 1
) => {
  const result = new WorkspaceCheckRun({ ...run(), id, status, attempt })
  const update = new WorkspaceCheckUpdate({
    callbackId: `${id}:${attempt}:${status}`,
    run: result,
  })
  checks.apply(update)
  return update
}

describe("Check completion hook", () => {
  test("opted-in failed Checks continue the agent and passed Checks do not", async () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    finish(checks, "failed")
    finish(checks, "passed", "passed")
    const delivered: { text: string; resume: boolean }[] = []
    await checks.deliverCompletions(async (completion) => {
      delivered.push(completion)
    })
    expect(delivered.map((item) => item.resume)).toEqual([true, false])
    expect(delivered[0]?.text).toContain("without weakening validation")
    expect(delivered[0]?.text).toContain(run().commit)
    expect(checks.hasPendingCompletions()).toBeFalse()
  })

  test("retries durable delivery after failure and restart without spending another continuation", async () => {
    const storage = new TestSqlStorage()
    const checks = new WorkspaceChecks(storage)
    checks.initialize()
    const update = finish(checks, "failed")
    const ids: string[] = []
    await expect(
      checks.deliverCompletions(async (completion) => {
        ids.push(completion.id)
        throw new Error("receiver accepted; acknowledgement lost")
      })
    ).rejects.toThrow("acknowledgement lost")
    const restarted = new WorkspaceChecks(storage)
    restarted.initialize()
    expect(restarted.apply(update)).toBeFalse()
    await restarted.deliverCompletions(async (completion) => {
      ids.push(completion.id)
    })
    expect(ids).toEqual([
      "msg_check-completion:failed:1",
      "msg_check-completion:failed:1",
    ])
    expect(restarted.checkContinuationsUsed()).toBe(1)
    await restarted.deliverCompletions(async () => {
      throw new Error("duplicate delivery")
    })
  })

  test("limits continuation across new Checks and resets only for a User message or passing Check", async () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    for (let index = 0; index < 4; index += 1)
      finish(checks, `failure-${index}`)
    const messages: { resume: boolean; text: string }[] = []
    await checks.deliverCompletions(async (completion) => {
      messages.push(completion)
    })
    expect(messages.map((item) => item.resume)).toEqual([
      true,
      true,
      true,
      false,
    ])
    expect(messages[3]?.text).toContain("3-Turn limit")
    expect(checks.checkContinuationsUsed()).toBe(3)
    checks.resetCheckContinuations("user-message")
    finish(checks, "after-user")
    await checks.deliverCompletions(async () => {})
    expect(checks.checkContinuationsUsed()).toBe(1)
    checks.resetCheckContinuations("user-message")
    expect(checks.checkContinuationsUsed()).toBe(1)
    finish(checks, "passed", "passed")
    expect(checks.checkContinuationsUsed()).toBe(0)
  })

  test("terminal results cannot regress or spend the budget twice", async () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    const update = finish(checks, "check-1")
    expect(
      checks.apply(
        new WorkspaceCheckUpdate({
          ...update,
          callbackId: "different-callback",
        })
      )
    ).toBeFalse()
    expect(
      checks.apply(
        new WorkspaceCheckUpdate({
          callbackId: "late-running",
          run: new WorkspaceCheckRun({ ...update.run, status: "running" }),
        })
      )
    ).toBeFalse()
    await checks.deliverCompletions(async () => {})
    const retried = checks.retry("check-1", "retry")
    expect(checks.apply(update)).toBeFalse()
    expect(checks.get("check-1")?.attempt).toBe(retried.attempt)
    finish(checks, "check-1", "failed", 2)
    await checks.deliverCompletions(async () => {})
    expect(checks.checkContinuationsUsed()).toBe(2)
  })

  test("production and legacy dependency results never resume the agent", async () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    for (const kind of ["production", "dependencies"] as const) {
      checks.apply(
        new WorkspaceCheckUpdate({
          callbackId: kind,
          run: new WorkspaceCheckRun({
            ...run(),
            id: kind,
            kind,
            status: "failed",
          }),
        })
      )
    }
    const delivered: boolean[] = []
    await checks.deliverCompletions(async (completion) => {
      delivered.push(completion.resume)
    })
    expect(delivered).toEqual([false])
    expect(checks.checkContinuationsUsed()).toBe(0)
  })

  test("concurrent callbacks share delivery without duplicate sends", async () => {
    const checks = new WorkspaceChecks(new TestSqlStorage())
    checks.initialize()
    finish(checks, "failed")
    let count = 0
    await Promise.all([
      checks.deliverCompletions(async () => {
        count += 1
      }),
      checks.deliverCompletions(async () => {
        count += 1
      }),
    ])
    expect(count).toBe(1)
  })
})

test("completion receipt commits without spending budget before delivery", () => {
  const storage = new TestSqlStorage()
  const checks = new WorkspaceChecks(storage)
  checks.initialize()
  storage.failCallback = true
  expect(() => finish(checks, "failed")).toThrow("Callback storage failed")
  expect(checks.hasPendingCompletions()).toBeFalse()
  expect(checks.checkContinuationsUsed()).toBe(0)
  expect(checks.get("failed")).toBeNull()
  finish(checks, "failed")
  expect(checks.hasPendingCompletions()).toBeTrue()
  expect(checks.checkContinuationsUsed()).toBe(0)
})

test("obsolete failures cannot exhaust the current Check continuation budget", async () => {
  const checks = new WorkspaceChecks(new TestSqlStorage())
  checks.initialize()
  for (let index = 0; index < 4; index += 1) finish(checks, `check-${index}`)
  const delivered: boolean[] = []
  await checks.deliverCompletions(
    async (completion) => {
      delivered.push(completion.resume)
    },
    async (completion) => completion.runId === "check-3"
  )
  expect(delivered).toEqual([true])
  expect(checks.checkContinuationsUsed()).toBe(1)
})

test("an uncertain prior delivery retains its reservation when the Checkpoint changes", async () => {
  const checks = new WorkspaceChecks(new TestSqlStorage())
  checks.initialize()
  finish(checks, "old")
  await expect(
    checks.deliverCompletions(async () => {
      throw new Error("offline")
    })
  ).rejects.toThrow("offline")
  expect(checks.checkContinuationsUsed()).toBe(1)
  for (let index = 0; index < 3; index += 1) finish(checks, `current-${index}`)
  const delivered: boolean[] = []
  await checks.deliverCompletions(
    async (completion) => {
      delivered.push(completion.resume)
    },
    async (completion) => completion.runId !== "old"
  )
  expect(delivered).toEqual([true, true, false])
  expect(checks.checkContinuationsUsed()).toBe(3)
})

test("Preview expiry clears terminal Check URLs without overwriting newer attempts", () => {
  const checks = new WorkspaceChecks(new TestSqlStorage())
  checks.initialize()
  const completed = new WorkspaceCheckRun({
    ...run(),
    status: "passed",
    attempt: 2,
    previewUrl: "https://preview.account.workers.dev",
  })
  checks.create(completed)
  expect(
    checks.expirePreview({ runId: completed.id, attempt: 1, callbackId: "old" })
  ).toBeNull()
  expect(checks.get(completed.id)?.previewUrl).toBe(completed.previewUrl)
  const expired = checks.expirePreview({
    runId: completed.id,
    attempt: 2,
    callbackId: "current",
  })
  expect(expired?.status).toBe("passed")
  expect(checks.get(completed.id)?.previewUrl).toBeNull()
  expect(
    checks.expirePreview({
      runId: completed.id,
      attempt: 2,
      callbackId: "retry",
    })
  ).toBeNull()
})

test("checks are independent operations and automatic repair defaults off", async () => {
  const checks = new WorkspaceChecks(new TestSqlStorage())
  checks.initialize()
  const requested = newCheckRun({ ...run(), autoRepair: undefined })
  expect(requested.stages.map((stage) => stage.name)).toEqual([
    "install",
    "typecheck",
    "lint",
    "test",
    "build",
  ])
  checks.create(requested)
  checks.apply(
    new WorkspaceCheckUpdate({
      callbackId: "manual-failure",
      run: new WorkspaceCheckRun({ ...requested, status: "failed" }),
    })
  )
  const resumes: boolean[] = []
  await checks.deliverCompletions(async (completion) => {
    resumes.push(completion.resume)
  })
  expect(resumes).toEqual([false])
  expect(checks.checkContinuationsUsed()).toBe(0)
})

test("preview deployment skips quality checks and captures evidence only when requested", () => {
  const preview = newCheckRun({ ...run(), kind: "preview" })
  expect(preview.stages.map((stage) => stage.name)).toEqual([
    "install",
    "build",
    "preview",
  ])
  expect(
    newCheckRun({ ...preview, captureEvidence: true }).stages.map(
      (stage) => stage.name
    )
  ).toEqual(["install", "build", "preview", "browser"])
})

test("production release stages require explicit managed recovery opt-in", () => {
  const deployment = newCheckRun({ ...run(), kind: "production" })
  expect(deployment.stages.map((stage) => stage.name)).toEqual([
    "install",
    "build",
    "production",
  ])
  expect(
    newCheckRun({ ...deployment, managedRelease: true }).stages.map(
      (stage) => stage.name
    )
  ).toContain("release-prepare")
  expect(
    newCheckRun({ ...deployment, managedRelease: true }).stages.map(
      (stage) => stage.name
    )
  ).not.toContain("browser")
})
