import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { schema } from "@workspace/db"
import { WorkspaceId, WorkspacePromptInput } from "@workspace/domain"
import {
  dispatchPendingWorkspacePrompt,
  pendingPromptMessages,
  savePendingWorkspacePrompt,
} from "./workspace-pending-prompts"

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
    "INSERT INTO workspace (id, project_id, organization_id, owner_user_id, title, base_artifact_repo, workspace_artifact_repo) VALUES ('workspace', 'project', 'organization', 'user', 'Workspace', 'base', 'fork')"
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
  return { database, sqlite }
}
const prompt = (id: string, text = id) =>
  new WorkspacePromptInput({
    workspaceId: WorkspaceId.make("workspace"),
    messageId: id,
    text,
    model: { providerId: "openrouter", modelId: "test" },
  })

test("persists messages in submission order through startup and delivers after readiness", async () => {
  const { database, sqlite } = fixture()
  try {
    const first = await savePendingWorkspacePrompt(
      database,
      "user",
      prompt("first")
    )
    const second = await savePendingWorkspacePrompt(
      database,
      "user",
      prompt("second")
    )
    const sent: string[] = []
    const send = async (
      row: typeof schema.workspacePendingPrompt.$inferSelect
    ) => {
      sent.push(row.id)
    }
    expect(await dispatchPendingWorkspacePrompt(database, first, send)).toBe(
      "waiting"
    )
    expect(sent).toEqual([])
    expect(
      (await pendingPromptMessages(database, "workspace")).map(
        (item) => item.text
      )
    ).toEqual(["first", "second"])
    sqlite.exec("UPDATE workspace SET status='ready'")
    expect(await dispatchPendingWorkspacePrompt(database, second, send)).toBe(
      "waiting"
    )
    expect(await dispatchPendingWorkspacePrompt(database, first, send)).toBe(
      "done"
    )
    expect(await dispatchPendingWorkspacePrompt(database, first, send)).toBe(
      "done"
    )
    expect(await dispatchPendingWorkspacePrompt(database, second, send)).toBe(
      "done"
    )
    expect(sent).toEqual(["first", "second"])
    expect(await pendingPromptMessages(database, "workspace")).toEqual([])
  } finally {
    sqlite.close()
  }
})

test("retains messages through setup failure and failed delivery", async () => {
  const { database, sqlite } = fixture()
  try {
    const queued = await savePendingWorkspacePrompt(
      database,
      "user",
      prompt("one")
    )
    sqlite.exec("UPDATE workspace SET status='error'")
    let attempts = 0
    const send = async () => {
      attempts += 1
      throw new Error("Unavailable")
    }
    expect(await dispatchPendingWorkspacePrompt(database, queued, send)).toBe(
      "waiting"
    )
    expect(attempts).toBe(0)
    sqlite.exec("UPDATE workspace SET status='ready'")
    await expect(
      dispatchPendingWorkspacePrompt(database, queued, send)
    ).rejects.toThrow("Unavailable")
    expect(await pendingPromptMessages(database, "workspace")).toHaveLength(1)
    expect(
      await dispatchPendingWorkspacePrompt(database, queued, async () => {})
    ).toBe("done")
  } finally {
    sqlite.close()
  }
})

test("bounds the durable queue and makes submission retries idempotent", async () => {
  const { database, sqlite } = fixture()
  try {
    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        savePendingWorkspacePrompt(database, "user", prompt(String(index)))
      )
    )
    await savePendingWorkspacePrompt(database, "user", prompt("0"))
    await expect(
      savePendingWorkspacePrompt(database, "user", prompt("overflow"))
    ).rejects.toThrow("5 queued messages")
    await expect(
      savePendingWorkspacePrompt(database, "other-user", prompt("0"))
    ).rejects.toThrow("another message")
    await expect(
      savePendingWorkspacePrompt(
        database,
        "user",
        prompt("0", "different text")
      )
    ).rejects.toThrow("another message")
    expect(await pendingPromptMessages(database, "workspace")).toHaveLength(5)
  } finally {
    sqlite.close()
  }
})

test("reuses the same delivery ID after an acknowledgement write fails", async () => {
  const { database, sqlite } = fixture()
  try {
    const queued = await savePendingWorkspacePrompt(
      database,
      "user",
      prompt("one")
    )
    sqlite.exec("UPDATE workspace SET status='ready'")
    sqlite.exec(
      "CREATE TRIGGER fail_ack BEFORE UPDATE OF delivered_at ON workspace_pending_prompt BEGIN SELECT RAISE(ABORT, 'ack failed'); END"
    )
    const ids: string[] = []
    const send = async (
      row: typeof schema.workspacePendingPrompt.$inferSelect
    ) => {
      ids.push(row.id)
    }
    await expect(
      dispatchPendingWorkspacePrompt(database, queued, send)
    ).rejects.toThrow()
    sqlite.exec("DROP TRIGGER fail_ack")
    await dispatchPendingWorkspacePrompt(database, queued, send)
    expect(ids).toEqual(["one", "one"])
  } finally {
    sqlite.close()
  }
})

test("waits for an active turn without acknowledging the pending prompt", async () => {
  const { database, sqlite } = fixture()
  try {
    const queued = await savePendingWorkspacePrompt(
      database,
      "user",
      prompt("one")
    )
    sqlite.exec("UPDATE workspace SET status='running'")
    expect(
      await dispatchPendingWorkspacePrompt(
        database,
        queued,
        async () => "waiting"
      )
    ).toBe("waiting")
    expect(await pendingPromptMessages(database, "workspace")).toHaveLength(1)
  } finally {
    sqlite.close()
  }
})

test("workflow retries reuse a fork and record its actual head", async () => {
  const { database, sqlite } = fixture()
  try {
    const { forkWorkspaceRepository } =
      await import("./workspace-repository-provisioning")
    const { Effect } = await import("effect")
    const { RepositoryStoreError } = await import("./repository-store")
    let created = false
    let inspections = 0
    const repository = {
      id: "repo",
      name: "fork",
      remote: "https://example.com/fork",
      defaultBranch: "main",
    }
    const repositories = {
      fork: () => {
        if (created)
          return Effect.fail(
            new RepositoryStoreError({
              operation: "fork",
              code: "ALREADY_EXISTS",
              retryable: false,
              message: "exists",
            })
          )
        created = true
        return Effect.succeed(repository)
      },
      inspect: () => {
        inspections += 1
        return Effect.succeed(repository)
      },
      head: (name: string) => {
        expect(name).toBe("fork")
        return Effect.succeed("a".repeat(40))
      },
    }
    sqlite.exec(
      "CREATE TRIGGER fail_fork_record BEFORE UPDATE ON workspace BEGIN SELECT RAISE(ABORT, 'lost acknowledgement'); END"
    )
    await expect(
      forkWorkspaceRepository(database, "workspace", repositories)
    ).rejects.toThrow()
    sqlite.exec("DROP TRIGGER fail_fork_record")
    await forkWorkspaceRepository(database, "workspace", repositories)
    expect(inspections).toBe(1)
    expect(
      sqlite.query("SELECT base_commit, fork_head FROM workspace").get()
    ).toEqual({ base_commit: "a".repeat(40), fork_head: "a".repeat(40) })
    await forkWorkspaceRepository(database, "workspace", repositories)
    expect(inspections).toBe(1)
    sqlite.exec("UPDATE workspace SET status='archived'")
    await forkWorkspaceRepository(database, "workspace", repositories)
    expect(inspections).toBe(1)
  } finally {
    sqlite.close()
  }
})
