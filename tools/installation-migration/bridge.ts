import { Schema } from "effect"
import { InstallationMigrationD1Import } from "@workspace/domain/installation-migration"
import { DurableObject } from "cloudflare:workers"
import { inventoryInstallation } from "./d1-inventory"
import { exportWorkspace, importWorkspace } from "./workspace-storage"

interface BridgeEnvironment {
  MIGRATION_DATABASE_ID: string
  MIGRATION_NAMESPACE_ID: string
  MIGRATION_TOKEN: string
  MIGRATION_MODE: "source" | "target"
  WORKSPACES: DurableObjectNamespace
  DB: D1Database
}

export class WorkspaceDO extends DurableObject<BridgeEnvironment> {
  async fetch(request: Request) {
    if (
      request.headers.get("authorization") !==
        `Bearer ${this.env.MIGRATION_TOKEN}` ||
      !this.env.MIGRATION_TOKEN
    )
      return new Response("Unauthorized", { status: 401 })
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")
    if (!workspaceId)
      return new Response("Workspace identity required", { status: 400 })
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        if (request.method === "GET")
          return Response.json(
            await exportWorkspace(this.ctx.storage, workspaceId)
          )
        if (request.method === "POST" && this.env.MIGRATION_MODE === "target")
          return Response.json(
            await importWorkspace(
              this.ctx.storage,
              workspaceId,
              await request.json()
            )
          )
        return new Response("Installation migration maintenance", {
          status: 503,
        })
      } catch {
        return new Response(
          "Workspace migration rejected; retained source is unchanged",
          { status: 409 }
        )
      }
    })
  }
  async alarm() {
    throw new Error("Drain alarms before bridge deployment")
  }
}

export default {
  async fetch(request: Request, env: BridgeEnvironment) {
    if (
      !env.MIGRATION_TOKEN ||
      request.headers.get("authorization") !== `Bearer ${env.MIGRATION_TOKEN}`
    )
      return new Response("Unauthorized", { status: 401 })
    const url = new URL(request.url)
    if (
      url.pathname === "/__sylph/installation-migration/database" &&
      request.method === "POST" &&
      env.MIGRATION_MODE === "target"
    ) {
      const input = Schema.decodeUnknownSync(InstallationMigrationD1Import)(
        await request.json()
      )
      if (
        input.sourceDatabaseId === env.MIGRATION_DATABASE_ID ||
        input.targetDatabaseId !== env.MIGRATION_DATABASE_ID ||
        input.sql.length > 32 * 1024 * 1024 ||
        input.statements.length > 900 ||
        input.statements.join("\n") !== input.sql
      )
        return new Response("Target database identity or size rejected", {
          status: 409,
        })
      const bytes = new TextEncoder().encode(input.sql)
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (value) => value.toString(16).padStart(2, "0")
      ).join("")
      if (hash !== input.sha256)
        return new Response("Database content hash rejected", { status: 409 })
      const tables = await env.DB.prepare(
        "SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV','_cf_METADATA')"
      ).all()
      if (tables.results.length)
        return new Response("Target database must be empty", { status: 409 })
      await env.DB.batch(
        input.statements.map((statement) => env.DB.prepare(statement))
      )
      return Response.json({
        databaseId: env.MIGRATION_DATABASE_ID,
        sha256: input.sha256,
      })
    }
    if (
      url.pathname === "/__sylph/installation-migration/inventory" &&
      request.method === "GET"
    )
      return Response.json(
        await inventoryInstallation(
          env.DB,
          env.MIGRATION_DATABASE_ID,
          env.MIGRATION_NAMESPACE_ID
        )
      )
    const workspaceId = url.searchParams.get("workspaceId")
    if (url.pathname !== "/__sylph/installation-migration" || !workspaceId)
      return new Response("Installation migration maintenance", { status: 503 })
    const row = await env.DB.prepare("SELECT id FROM workspace WHERE id = ?")
      .bind(workspaceId)
      .first<{ id: string }>()
    if (!row) return new Response("Unknown Workspace", { status: 404 })
    return env.WORKSPACES.get(env.WORKSPACES.idFromName(row.id)).fetch(request)
  },
}
