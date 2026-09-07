import { Database } from "bun:sqlite"
import { expect, mock, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { schema } from "@workspace/db"
import { Effect } from "effect"
import { RestartWorkspaceInput, WorkspaceId } from "@workspace/domain"
import { requireWritableWorkspace } from "./organization-access"
import {
  requestWorkspaceRestart,
  workspaceProvisioningInput,
} from "./workspace-provisioning-request"

let database
let events
let failures
let invalidCredential
let connectionAvailable
let selectedModel
let initialization
let afterInitialize

const repository = {
  id: "fork",
  name: "fork",
  remote: "https://example.com/fork",
  defaultBranch: "starter",
}
mock.module("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {
    constructor(env) {
      this.env = env
    }
  },
}))
mock.module("drizzle-orm/d1", () => ({ drizzle: () => database }))
mock.module("./organization-access", () => ({
  requireWorkspaceProject: async () => ({
    id: "project",
    name: "Project",
    repositoryName: "base",
    repositoryRemote: "https://example.com/base",
    defaultBranch: "main",
  }),
}))
mock.module("./instance-model-policy", () => ({
  assertInstanceModelEnabled: async () => undefined,
}))
mock.module("./provider-connections", () => ({
  effectiveConnection: async (_database, _organization, _user, model) => {
    selectedModel = model
    return connectionAvailable
      ? {
          providerId: model?.providerId ?? "openrouter",
          modelId: model?.modelId ?? "default",
        }
      : null
  },
  connectionCredential: async () => {
    if (invalidCredential) throw new Error("Invalid saved credential")
    return { type: "key", key: "fixture" }
  },
}))
mock.module("./repositories", () => ({
  repositoryStore: () => ({
    fork: () => {
      events.push("fork")
      return Effect.succeed(repository)
    },
    inspect: () => Effect.succeed(repository),
    head: () => Effect.succeed("a".repeat(40)),
  }),
}))
mock.module("./project-repository-sync", () => ({
  synchronizeProjectRepository: async () => {
    events.push("synchronize")
  },
}))
mock.module("./workspace-runtime", () => ({
  workspaceRuntime: () => ({
    evict: async () => {
      events.push("evict")
    },
    initialize: async (input) => {
      events.push("initialize")
      initialization = input
      if (failures-- > 0) throw new Error("runtime unavailable")
      await afterInitialize?.()
    },
  }),
}))
const { WorkspaceProvisioning } = await import("./workspace-provisioning")
const step = {
  do: async (name, options, callback) => {
    const run = callback ?? options
    for (let attempt = 0; ; attempt++) {
      try {
        return await run()
      } catch (cause) {
        if (attempt >= (options.retries?.limit ?? 0)) throw cause
      }
    }
  },
}
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
    "INSERT INTO workspace (id, project_id, organization_id, owner_user_id, title, base_artifact_repo, workspace_artifact_repo) VALUES ('workspace', 'project', 'organization', 'owner', 'Workspace', 'base', 'fork')"
  )
  database = drizzle(
    async (query, parameters, method) => {
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
  events = []
  failures = 0
  connectionAvailable = true
  invalidCredential = false
  selectedModel = undefined
  initialization = undefined
  afterInitialize = undefined
  return { sqlite, [Symbol.dispose]: () => sqlite.close() }
}
const run = (payload) =>
  new WorkspaceProvisioning({ DB: null }).run({ payload }, step)
const restart = async () =>
  workspaceProvisioningInput(
    await requestWorkspaceRestart(
      database,
      new RestartWorkspaceInput({
        workspaceId: WorkspaceId.make("workspace"),
        idempotencyKey: crypto.randomUUID(),
        model: { providerId: "openrouter", modelId: "selected" },
      })
    )
  )

test("first initialization prepares a fork and uses its source ref", async () => {
  using state = fixture()
  await run({ workspaceId: "workspace" })
  expect(events).toEqual(["synchronize", "fork", "initialize"])
  expect(initialization.sourceRef).toBe("starter")
  expect(
    state.sqlite.query("SELECT status, sync_status FROM workspace").get()
  ).toEqual({ status: "ready", sync_status: "ready" })
})

test("restart evicts before initialization and keeps the existing fork and requested model", async () => {
  using state = fixture()
  state.sqlite.exec(
    "UPDATE workspace SET status='ready', base_commit='base', fork_head='checkpoint'"
  )
  await run(await restart())
  expect(events).toEqual(["evict", "initialize"])
  expect(selectedModel.modelId).toBe("selected")
  expect(initialization.baseCommit).toBe("base")
  expect(
    state.sqlite.query("SELECT status, fork_head FROM workspace").get()
  ).toEqual({ status: "ready", fork_head: "checkpoint" })
})

test("a failed runtime is evicted before Workflow initialization retries", async () => {
  using state = fixture()
  state.sqlite.exec("UPDATE workspace SET status='error', base_commit='base'")
  const input = await restart()
  failures = 1
  await run(input)
  expect(events).toEqual([
    "evict",
    "initialize",
    "evict",
    "evict",
    "initialize",
  ])
})

test("archived Workspaces stay read-only during restart and restore archived status", async () => {
  using state = fixture()
  state.sqlite.exec(
    "UPDATE workspace SET status='archived', archived_at=123, base_commit='base'"
  )
  const input = await restart()
  const workspace = await database.select().from(schema.workspace).get()
  expect(() => requireWritableWorkspace(workspace)).toThrow("read-only")
  await run(input)
  expect(initialization.archivedAt).toBe(123000)
  expect(state.sqlite.query("SELECT status FROM workspace").get()).toEqual({
    status: "archived",
  })
})

test("exhausted initialization retries record failure and preserve archived state", async () => {
  using state = fixture()
  state.sqlite.exec(
    "UPDATE workspace SET status='archived', archived_at=123, base_commit='base'"
  )
  const input = await restart()
  failures = 10
  await expect(run(input)).rejects.toThrow("runtime unavailable")
  expect(events.filter((event) => event === "initialize")).toHaveLength(3)
  expect(
    state.sqlite.query("SELECT status, error_summary FROM workspace").get()
  ).toEqual({ status: "archived", error_summary: "runtime unavailable" })
})

test("a missing Provider connection records a recoverable startup error", async () => {
  using state = fixture()
  connectionAvailable = false
  await expect(run({ workspaceId: "workspace" })).rejects.toThrow(
    "Connect an AI provider"
  )
  expect(state.sqlite.query("SELECT status FROM workspace").get()).toEqual({
    status: "error",
  })
  expect(events).not.toContain("initialize")
})

test("completion cannot overwrite a Workspace archived during initialization", async () => {
  using state = fixture()
  afterInitialize = async () => {
    state.sqlite.exec("UPDATE workspace SET status='archived', archived_at=123")
  }
  await run({ workspaceId: "workspace" })
  expect(state.sqlite.query("SELECT status FROM workspace").get()).toEqual({
    status: "archived",
  })
})

test("restart does not evict when the Provider connection is missing", async () => {
  using state = fixture()
  state.sqlite.exec("UPDATE workspace SET status='ready', base_commit='base'")
  const input = await restart()
  connectionAvailable = false
  await expect(run(input)).rejects.toThrow("Connect an AI provider")
  expect(events).not.toContain("evict")
  expect(events).not.toContain("initialize")
})

test("restart does not evict when saved credentials cannot be decoded", async () => {
  using state = fixture()
  state.sqlite.exec("UPDATE workspace SET status='ready', base_commit='base'")
  const input = await restart()
  invalidCredential = true
  await expect(run(input)).rejects.toThrow("Invalid saved credential")
  expect(events).not.toContain("evict")
  expect(events).not.toContain("initialize")
})
