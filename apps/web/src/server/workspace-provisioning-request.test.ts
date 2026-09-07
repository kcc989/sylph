import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { schema } from "@workspace/db"
import {
  RestartWorkspaceInput,
  WorkspaceId,
  WorkspaceProvisioningInput,
} from "@workspace/domain"
import { Effect } from "effect"
import {
  activeProvisioningRequest,
  readProvisioningWorkspace,
  requestWorkspaceRestart,
  workspaceProvisioningId,
  workspaceProvisioningInput,
} from "./workspace-provisioning-request"
import { forkWorkspaceRepository } from "./workspace-repository-provisioning"

const fixture = () => {
  const sqlite = new Database(":memory:")
  const migrations = new URL(
    "../../../../packages/db/migrations/",
    import.meta.url
  )
  for (const file of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"))
  sqlite.exec("PRAGMA foreign_keys=OFF")
  sqlite.exec(
    "INSERT INTO workspace (id, project_id, organization_id, owner_user_id, title, base_artifact_repo, workspace_artifact_repo, status, base_commit, fork_head) VALUES ('workspace', 'project', 'organization', 'owner', 'Workspace', 'base', 'fork', 'ready', 'base-commit', 'checkpoint')"
  )
  const database = drizzle(
    async (query, parameters, method) => {
      expect(parameters.length).toBeLessThanOrEqual(100)
      const statement = sqlite.query(query)
      if (method === "run") {
        statement.run(...parameters)
        return { rows: [] }
      }
      const rows = statement.values(...parameters)
      return { rows: method === "get" ? rows[0] : rows }
    },
    { schema }
  )
  return { database, sqlite, [Symbol.dispose]: () => sqlite.close() }
}
const restart = (idempotencyKey = crypto.randomUUID()) =>
  new RestartWorkspaceInput({
    workspaceId: WorkspaceId.make("workspace"),
    idempotencyKey,
    model: { providerId: "openrouter", modelId: "model" },
  })

test("restart persists the selected model and recovery can reconstruct the same execution", async () => {
  using state = fixture()
  const request = restart()
  const workspace = await requestWorkspaceRestart(state.database, request)
  expect(workspace.status).toBe("provisioning")
  expect(workspace.provisioningScheduledAt).toBeNull()
  expect(workspace.baseCommit).toBe("base-commit")
  expect(workspace.forkHead).toBe("checkpoint")
  const input = workspaceProvisioningInput(workspace)
  expect(input.restart?.model).toEqual(request.model)
  expect(workspaceProvisioningId(input)).toBe(
    `restart-workspace-${request.idempotencyKey}`
  )
  expect(
    workspaceProvisioningId(
      workspaceProvisioningInput(
        await requestWorkspaceRestart(state.database, request)
      )
    )
  ).toBe(workspaceProvisioningId(input))
})

test("repeating a completed restart does not start provisioning again", async () => {
  using state = fixture()
  const request = restart()
  await requestWorkspaceRestart(state.database, request)
  state.sqlite.exec(
    "UPDATE workspace SET status='ready', provisioning_scheduled_at=123"
  )
  const workspace = await requestWorkspaceRestart(state.database, request)
  expect(workspace.status).toBe("ready")
  expect(workspace.provisioningScheduledAt).toBe(123)
})

test("each explicit restart gets a new execution and old executions cannot write status", async () => {
  using state = fixture()
  const first = workspaceProvisioningInput(
    await requestWorkspaceRestart(state.database, restart())
  )
  state.sqlite.exec("UPDATE workspace SET status='error'")
  const second = workspaceProvisioningInput(
    await requestWorkspaceRestart(state.database, restart())
  )
  expect(workspaceProvisioningId(first)).not.toBe(
    workspaceProvisioningId(second)
  )
  expect(await readProvisioningWorkspace(state.database, first)).toBeUndefined()
  await state.database
    .update(schema.workspace)
    .set({ status: "ready" })
    .where(activeProvisioningRequest(first))
  expect(
    (await readProvisioningWorkspace(state.database, second))?.status
  ).toBe("provisioning")
  const original = new WorkspaceProvisioningInput({
    workspaceId: WorkspaceId.make("workspace"),
  })
  expect(
    await readProvisioningWorkspace(state.database, original)
  ).toBeUndefined()
})

test("concurrent restart requests select one execution", async () => {
  using state = fixture()
  const results = await Promise.allSettled([
    requestWorkspaceRestart(state.database, restart()),
    requestWorkspaceRestart(state.database, restart()),
  ])
  expect(
    results.filter((result) => result.status === "fulfilled")
  ).toHaveLength(1)
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1
  )
})

test("a restart key cannot be reused with another model", async () => {
  using state = fixture()
  const request = restart()
  await requestWorkspaceRestart(state.database, request)
  await expect(
    requestWorkspaceRestart(
      state.database,
      new RestartWorkspaceInput({
        ...request,
        model: { providerId: "openrouter", modelId: "other" },
      })
    )
  ).rejects.toThrow("another model")
})

test("restart does not overlap provisioning or Acceptance", async () => {
  using state = fixture()
  for (const status of ["provisioning", "merging"]) {
    state.sqlite.query("UPDATE workspace SET status=?").run(status)
    await expect(
      requestWorkspaceRestart(state.database, restart())
    ).rejects.toThrow("current Workspace operation")
  }
})

test("archived restart retains its read-only marker and terminal updates are guarded", async () => {
  using state = fixture()
  state.sqlite.exec("UPDATE workspace SET status='archived', archived_at=123")
  const workspace = await requestWorkspaceRestart(state.database, restart())
  expect(workspace.archivedAt?.getTime()).toBe(123000)
  const input = workspaceProvisioningInput(workspace)
  state.sqlite.exec("UPDATE workspace SET status='archived'")
  await state.database
    .update(schema.workspace)
    .set({ status: "ready" })
    .where(activeProvisioningRequest(input))
  expect(await readProvisioningWorkspace(state.database, input)).toBeUndefined()
  expect(state.sqlite.query("SELECT status FROM workspace").get()).toEqual({
    status: "archived",
  })
})

test("restart reuses an existing fork without reading or changing its head", async () => {
  using state = fixture()
  const workspace = await requestWorkspaceRestart(state.database, restart())
  const unexpected = () => {
    throw new Error("existing fork must be retained")
  }
  await forkWorkspaceRepository(
    state.database,
    workspaceProvisioningInput(workspace),
    {
      fork: unexpected,
      inspect: unexpected,
      head: unexpected,
    }
  )
  expect(
    state.sqlite.query("SELECT base_commit, fork_head FROM workspace").get()
  ).toEqual({ base_commit: "base-commit", fork_head: "checkpoint" })
})

test("an old fork operation cannot overwrite a newer restart", async () => {
  using state = fixture()
  state.sqlite.exec(
    "UPDATE workspace SET status='provisioning', base_commit=NULL, fork_head=NULL"
  )
  const original = new WorkspaceProvisioningInput({
    workspaceId: WorkspaceId.make("workspace"),
  })
  const repository = {
    id: "fork",
    name: "fork",
    remote: "https://example.com/fork",
    defaultBranch: "main",
  }
  await forkWorkspaceRepository(state.database, original, {
    fork: () =>
      Effect.promise(async () => {
        state.sqlite.exec("UPDATE workspace SET status='error'")
        await requestWorkspaceRestart(state.database, restart())
        return repository
      }),
    inspect: () => Effect.succeed(repository),
    head: () => Effect.succeed("old-head"),
  })
  expect(
    state.sqlite.query("SELECT base_commit, fork_head FROM workspace").get()
  ).toEqual({ base_commit: null, fork_head: null })
})
