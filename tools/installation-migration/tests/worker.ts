import bridge from "../bridge"
import { inventoryInstallation } from "../d1-inventory"
import supportedMigrations from "../sources/workspace-migrations.json"
import { DurableObject } from "cloudflare:workers"
import { exportWorkspace, importWorkspace } from "../workspace-storage"

interface Environment {
  DB: D1Database
  SOURCE_DB: D1Database
  D1_STATEMENTS: string[]
  SOURCE_SQL: string
  SOURCE: DurableObjectNamespace
  TARGET: DurableObjectNamespace
}
export class FixtureWorkspace extends DurableObject<Environment> {
  async fetch(request: Request) {
    const path = new URL(request.url).pathname
    try {
      if (path === "/seed") {
        this.ctx.storage.sql.exec(this.env.SOURCE_SQL)
        for (const id of supportedMigrations)
          this.ctx.storage.sql.exec(
            "INSERT INTO migration(id,time_completed) VALUES (?,1)",
            id
          )
        this.ctx.storage.sql.exec(
          "INSERT INTO app_workspace_state(workspace_id,organization_id,project_id,repository_name,repository_remote) VALUES ('workspace-a','org','project','repo','https://repo.test')"
        )
        this.ctx.storage.sql.exec(
          "INSERT INTO project(id,worktree,time_created,time_updated,sandboxes) VALUES ('project-a','/workspace',1,1,'[]')"
        )
        this.ctx.storage.sql.exec(
          "INSERT INTO session_v2(id,project_id,slug,directory,version,time_created,time_updated,time_idle) VALUES ('session-a','project-a','session-a','/workspace','1',1,1,2)"
        )
        this.ctx.storage.sql.exec(
          "INSERT INTO session_message(id,session_id,type,seq,time_created,time_updated,data) VALUES ('message-a','session-a','user',1,1,1,?)",
          JSON.stringify({ role: "user", content: "Keep my transcript" })
        )
        this.ctx.storage.sql.exec(
          "INSERT INTO session_inbox(id,session_id,type,payload,delivery,enqueued_seq,time_created) VALUES ('inbox-a','session-a','message','{\"text\":\"waiting input\"}','queue',2,2)"
        )
        this.ctx.storage.sql.exec(
          "INSERT INTO session_pending(id,session_id,type,data,admitted_seq,time_created) VALUES ('form-a','session-a','question','{\"questions\":[\"Choose a color\"]}',3,3)"
        )
        this.ctx.storage.sql.exec(
          "INSERT INTO permission(id,project_id,action,resource,time_created,time_updated) VALUES ('permission-a','project-a','write','/workspace/*',1,1)"
        )
        this.ctx.storage.sql.exec(
          "INSERT INTO app_workspace_file(path,content,size,updated_at) VALUES ('binary.dat',X'000102FF',4,1)"
        )
        this.ctx.storage.sql.exec(
          "INSERT INTO app_workspace_file(path,content,size,updated_at) VALUES ('text.txt',CAST(? AS BLOB),5,1)",
          "a\u0000b😀"
        )
        this.ctx.storage.sql.exec(
          "INSERT INTO app_filesystem_event(sequence,kind,path,created_at) VALUES (9223372036854775806,'write','binary.dat',1)"
        )
        await this.ctx.storage.put("browser-session", {
          cookie: "retained",
          bytes: new Uint8Array([0, 255]),
          date: new Date(1),
          map: new Map([["key", 5n]]),
        })
        return new Response("seeded")
      }
      if (path === "/schema")
        return Response.json(
          this.ctx.storage.sql
            .exec(
              "SELECT type,name,tbl_name AS 'table',sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('__cf_kv','_cf_KV') ORDER BY type,name"
            )
            .toArray()
        )
      if (path === "/active")
        this.ctx.storage.sql.exec("UPDATE session_v2 SET time_idle=NULL")
      if (path === "/unknown")
        this.ctx.storage.sql.exec("CREATE TABLE unknown_state(id TEXT)")
      if (path === "/import")
        return Response.json(
          await importWorkspace(
            this.ctx.storage,
            "workspace-a",
            await request.json()
          )
        )
      if (path === "/content")
        return Response.json({
          files: this.ctx.storage.sql
            .exec(
              "SELECT path,hex(content) AS bytes FROM app_workspace_file ORDER BY path"
            )
            .toArray(),
          transcripts: this.ctx.storage.sql
            .exec("SELECT data FROM session_message")
            .toArray(),
          forms: this.ctx.storage.sql
            .exec("SELECT data FROM session_pending")
            .toArray(),
          inbox: this.ctx.storage.sql
            .exec("SELECT payload FROM session_inbox")
            .toArray(),
          permissions: this.ctx.storage.sql
            .exec("SELECT action,resource FROM permission")
            .toArray(),
          sequence: this.ctx.storage.sql
            .exec(
              "SELECT CAST(sequence AS TEXT) AS sequence FROM app_filesystem_event"
            )
            .toArray(),
        })
      return Response.json(
        await exportWorkspace(this.ctx.storage, "workspace-a")
      )
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 409 })
    }
  }
}
export class TargetWorkspace extends FixtureWorkspace {}
export default {
  fetch(request: Request, env: Environment) {
    const path = new URL(request.url).pathname
    if (path === "/seed-d1")
      return env.SOURCE_DB.batch(
        env.D1_STATEMENTS.map((statement) => env.SOURCE_DB.prepare(statement))
      ).then(() => new Response("seeded"))
    if (path === "/source-inventory")
      return inventoryInstallation(
        env.SOURCE_DB,
        "source-database",
        "source-namespace"
      ).then(Response.json)
    if (path.startsWith("/__sylph/"))
      return bridge.fetch(request, {
        ...env,
        WORKSPACES: env.TARGET,
        MIGRATION_TOKEN: "fixture-token",
        MIGRATION_MODE: "target",
        MIGRATION_DATABASE_ID: "target-database",
        MIGRATION_NAMESPACE_ID: "target-namespace",
      })
    const namespace = new URL(request.url).searchParams.get("target")
      ? env.TARGET
      : env.SOURCE
    return namespace.get(namespace.idFromName("workspace-a")).fetch(request)
  },
}
