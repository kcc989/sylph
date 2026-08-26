import {
  decodeInitializeWorkspaceRuntime,
  type InitializeWorkspaceRuntime,
} from "@workspace/domain"
import { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd"
import { DurableObject } from "cloudflare:workers"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/durable-sqlite"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"

const appWorkspaceState = sqliteTable("app_workspace_state", {
  workspaceId: text("workspace_id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  projectId: text("project_id").notNull(),
  repositoryName: text("repository_name").notNull(),
  repositoryRemote: text("repository_remote").notNull(),
})

export class WorkspaceDO extends DurableObject<Cloudflare.Env> {
  readonly #database
  readonly #opencode

  constructor(context: DurableObjectState, bindings: Cloudflare.Env) {
    super(context, bindings)
    this.#database = drizzle(context.storage, { schema: { appWorkspaceState } })
    this.#opencode = context.blockConcurrencyWhile(async () => {
      const hasAppWorkspaceState =
        context.storage.sql
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_workspace_state'"
          )
          .toArray().length > 0
      const hasOpenCodeSchema =
        context.storage.sql
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('migration', 'session_v2')"
          )
          .toArray().length > 0

      if (hasAppWorkspaceState && !hasOpenCodeSchema) {
        context.storage.sql.exec("DROP TABLE app_workspace_state")
      }

      let opencode: OpenCodeWorkerd.Interface

      try {
        opencode = await OpenCodeWorkerd.create({
          storage: context.storage,
          config: { default_agent: "build" },
        })
      } catch (error) {
        console.error("OpenCode host initialization failed", error)
        throw error
      }

      this.#database.run(sql`
        CREATE TABLE IF NOT EXISTS app_workspace_state (
          workspace_id TEXT PRIMARY KEY NOT NULL,
          organization_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          repository_name TEXT NOT NULL,
          repository_remote TEXT NOT NULL
        )
      `)
      return opencode
    })
  }

  async fetch(request: Request) {
    const opencode = await this.#opencode
    const url = new URL(request.url)

    if (request.method === "POST" && url.pathname === "/initialize") {
      const input = await decodeInitializeWorkspaceRuntime(await request.json())
      this.#initialize(input)
      return Response.json(await this.#health(opencode))
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json(await this.#health(opencode))
    }

    return new Response("Not found", { status: 404 })
  }

  #initialize(input: InitializeWorkspaceRuntime) {
    this.#database
      .insert(appWorkspaceState)
      .values(input)
      .onConflictDoUpdate({
        target: appWorkspaceState.workspaceId,
        set: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          repositoryName: input.repositoryName,
          repositoryRemote: input.repositoryRemote,
        },
      })
      .run()
  }

  async #health(opencode: OpenCodeWorkerd.Interface) {
    const state = this.#database.select().from(appWorkspaceState).get()
    return {
      workspaceId: state?.workspaceId ?? null,
      opencode: await opencode.health.get(),
    }
  }
}
