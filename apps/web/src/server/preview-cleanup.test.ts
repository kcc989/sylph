import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { requestPreviewCleanup, stopPreviewRetention } from "./preview-cleanup"
import type { ProjectResourceOperation } from "@workspace/domain/project-resources"
import type { ResourceDatabase } from "./project-resources"

const operation: ProjectResourceOperation = {
  project_id: "project",
  account_id: "account",
  scope: "preview:run:1",
  run_id: "ci-workflow",
  status: "retained",
  plan_json: "[]",
  error: null,
  inspected_at: 1,
}

test("retained cleanup terminates only a waiting Workflow and independently observes termination", async () => {
  const calls: string[] = []
  const terminal = await stopPreviewRetention(
    operation,
    { scope: operation.scope, runId: operation.run_id },
    {
      status: async () => {
        calls.push("status")
        return { status: calls.length === 1 ? "waiting" : "terminated" }
      },
      terminate: async () => {
        calls.push("terminate")
      },
    }
  )
  expect(terminal).toBe("terminated")
  expect(calls).toEqual(["status", "terminate", "status"])
  await expect(
    stopPreviewRetention(
      operation,
      { scope: operation.scope, runId: operation.run_id },
      { status: async () => ({ status: "waiting" }), terminate: async () => {} }
    )
  ).rejects.toThrow("still stopping")
})

test("active cleanup, production and stale run confirmation cannot terminate a Workflow", async () => {
  let terminated = 0
  for (const status of ["running", "queued", "paused", "unknown"])
    await expect(
      stopPreviewRetention(
        operation,
        { scope: operation.scope, runId: operation.run_id },
        {
          status: async () => ({ status }),
          terminate: async () => {
            terminated++
          },
        }
      )
    ).rejects.toThrow("still running")
  for (const changed of [
    { ...operation, scope: "production" },
    { ...operation, run_id: "new-run" },
    { ...operation, status: "deploying" as const },
  ])
    await expect(
      stopPreviewRetention(
        changed,
        { scope: operation.scope, runId: operation.run_id },
        {
          status: async () => ({ status: "waiting" }),
          terminate: async () => {
            terminated++
          },
        }
      )
    ).rejects.toThrow("Confirm")
  expect(terminated).toBe(0)
})

const fixture = async () => {
  const sql = new Database(":memory:")
  sql.exec(
    await Bun.file(
      new URL(
        "../../../../packages/db/migrations/0001_initial.sql",
        import.meta.url
      )
    ).text()
  )
  sql
    .query(
      "INSERT INTO project_resource_operation (project_id, account_id, scope, run_id, status, plan_json, error, inspected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      operation.project_id,
      operation.account_id,
      operation.scope,
      operation.run_id,
      operation.status,
      operation.plan_json,
      operation.error,
      operation.inspected_at
    )
  const prepare = (statement: string, values: Array<string | null> = []) => ({
    bind: (...bound: Array<string | null>) => prepare(statement, bound),
    first: async <T>() =>
      sql.query<T, Array<string | null>>(statement).get(...values),
    all: async <T>() => ({
      results: sql.query<T, Array<string | null>>(statement).all(...values),
    }),
    run: async () => {
      sql.query(statement).run(...values)
      return { success: true }
    },
  })
  const database: ResourceDatabase = {
    prepare,
    batch: async (statements) =>
      Promise.all(statements.map((statement) => statement.run())),
  }
  let ciStatus = "waiting"
  let maintenanceStatus = "queued"
  let lostResponse = false
  let mutateRun = false
  const created: string[] = []
  const workflows = {
    ci: {
      get: async () => ({
        status: async () => ({ status: ciStatus }),
        terminate: async () => {
          ciStatus = "terminated"
          if (mutateRun)
            sql.exec(
              "UPDATE project_resource_operation SET run_id = 'replacement'"
            )
        },
      }),
    },
    maintenance: {
      get: async () => ({
        status: async () => ({ status: maintenanceStatus }),
      }),
      create: async ({ id }: { id: string }) => {
        created.push(id)
        if (lostResponse) throw new Error("lost response")
        return { id }
      },
    },
  }
  const input = () => ({
    projectId: operation.project_id,
    scope: operation.scope,
    confirmedScope: operation.scope,
    confirmedRunId: operation.run_id,
    requestId: crypto.randomUUID(),
  })
  return {
    sql,
    database,
    workflows,
    created,
    input,
    setCi: (value: string) => {
      ciStatus = value
    },
    setMaintenance: (value: string) => {
      maintenanceStatus = value
    },
    loseResponse: () => {
      lostResponse = true
    },
    changeRunOnTerminate: () => {
      mutateRun = true
    },
  }
}

test("cleanup confirmation is audited and uncertain creation resolves the saved Workflow identity", async () => {
  const f = await fixture()
  try {
    f.loseResponse()
    const input = f.input()
    expect(
      await requestPreviewCleanup(f.database, input, "admin", f.workflows)
    ).toEqual({ workflowId: input.requestId })
    expect(
      f.sql
        .query(
          "SELECT actor_id, confirmed_scope, run_id, terminal_status, status FROM project_preview_cleanup_request"
        )
        .get()
    ).toEqual({
      actor_id: "admin",
      confirmed_scope: operation.scope,
      run_id: operation.run_id,
      terminal_status: "terminated",
      status: "dispatched",
    })
    await expect(
      requestPreviewCleanup(f.database, f.input(), "admin", f.workflows)
    ).rejects.toThrow("still running")
    expect(f.created).toEqual([input.requestId])
  } finally {
    f.sql.close()
  }
})

test("a real failed cleanup can be retried after its Workflow ends without losing its audit", async () => {
  const f = await fixture()
  try {
    await requestPreviewCleanup(f.database, f.input(), "admin", f.workflows)
    f.sql.exec(
      "UPDATE project_resource_operation SET status = 'cleanup_failed'"
    )
    f.setMaintenance("errored")
    await requestPreviewCleanup(f.database, f.input(), "admin", f.workflows)
    expect(f.created).toHaveLength(2)
    expect(
      f.sql
        .query(
          "SELECT status FROM project_preview_cleanup_request ORDER BY rowid"
        )
        .all()
    ).toEqual([{ status: "failed" }, { status: "dispatched" }])
  } finally {
    f.sql.close()
  }
})

test("run changes after termination stop dispatch and preserve an audit of the rejected confirmation", async () => {
  const f = await fixture()
  try {
    f.changeRunOnTerminate()
    await expect(
      requestPreviewCleanup(f.database, f.input(), "admin", f.workflows)
    ).rejects.toThrow("changed after")
    expect(f.created).toEqual([])
    expect(
      f.sql
        .query(
          "SELECT status, terminal_status FROM project_preview_cleanup_request"
        )
        .get()
    ).toEqual({ status: "failed", terminal_status: "terminated" })
  } finally {
    f.sql.close()
  }
})

test("failed automatic cleanup must finish its retries before manual cleanup can begin", async () => {
  let terminated = false
  await expect(
    stopPreviewRetention(
      { ...operation, status: "cleanup_failed" },
      { scope: operation.scope, runId: operation.run_id },
      {
        status: async () => ({ status: "waiting" }),
        terminate: async () => {
          terminated = true
        },
      }
    )
  ).rejects.toThrow("still running")
  expect(terminated).toBe(false)
})

test("a rejected running Workflow does not leave a permanent active cleanup lock", async () => {
  const f = await fixture()
  try {
    f.setCi("running")
    await expect(
      requestPreviewCleanup(f.database, f.input(), "admin", f.workflows)
    ).rejects.toThrow("still running")
    expect(
      f.sql.query("SELECT status FROM project_preview_cleanup_request").get()
    ).toEqual({ status: "failed" })
    f.setCi("waiting")
    await requestPreviewCleanup(f.database, f.input(), "admin", f.workflows)
    expect(f.created).toHaveLength(1)
  } finally {
    f.sql.close()
  }
})

test("saved pending confirmation resumes after refresh with the same dispatch identity", async () => {
  const f = await fixture()
  try {
    const original = f.input()
    f.sql
      .query(
        "INSERT INTO project_preview_cleanup_request (id, project_id, account_id, scope, run_id, actor_id, confirmed_scope, previous_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        original.requestId,
        operation.project_id,
        operation.account_id,
        operation.scope,
        operation.run_id,
        "admin",
        operation.scope,
        operation.status
      )
    await expect(
      requestPreviewCleanup(f.database, f.input(), "other-admin", f.workflows)
    ).rejects.toThrow("Another Admin")
    expect(
      await requestPreviewCleanup(f.database, f.input(), "admin", f.workflows)
    ).toEqual({ workflowId: original.requestId })
    expect(f.created).toEqual([original.requestId])
    expect(
      f.sql
        .query("SELECT count(*) AS count FROM project_preview_cleanup_request")
        .get()
    ).toEqual({ count: 1 })
  } finally {
    f.sql.close()
  }
})

test("a lost dispatch response followed by an errored Workflow does not strand the cleanup confirmation", async () => {
  const f = await fixture()
  try {
    f.loseResponse()
    f.setMaintenance("errored")
    await expect(
      requestPreviewCleanup(f.database, f.input(), "admin", f.workflows)
    ).rejects.toThrow("lost response")
    expect(
      f.sql.query("SELECT status FROM project_preview_cleanup_request").get()
    ).toEqual({ status: "failed" })
    f.sql.exec(
      "UPDATE project_resource_operation SET status = 'cleanup_failed'"
    )
    f.setMaintenance("queued")
    const retry = f.input()
    expect(
      await requestPreviewCleanup(f.database, retry, "admin", f.workflows)
    ).toEqual({ workflowId: retry.requestId })
    expect(f.created).toHaveLength(2)
  } finally {
    f.sql.close()
  }
})
