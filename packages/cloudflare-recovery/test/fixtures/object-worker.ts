import { DurableObject } from "cloudflare:workers"
import { Schema } from "effect"
import { RecoveryObjectRequest } from "@workspace/domain/cloudflare-object-recovery"
import {
  recoverDurableObject,
  withRecoveryObjectGate,
} from "../../src/object-worker"

type Environment = { OBJECT: DurableObjectNamespace; CONTROL: D1Database }

export class TestObject extends DurableObject<Environment> {
  async alarm() {}
  async fetch(request: Request) {
    const path = new URL(request.url).pathname
    if (path === "/id") return new Response(this.ctx.id.toString())
    if (path === "/recovery") {
      const input = Schema.decodeUnknownSync(RecoveryObjectRequest)(
        await request.json()
      )
      return Response.json(
        await recoverDurableObject(
          this.ctx,
          this.env.CONTROL,
          { namespaceId: "namespace", objectId: this.ctx.id.toString() },
          input,
          async () => {}
        )
      )
    }
    return withRecoveryObjectGate(this.env.CONTROL, async () => {
      if (path === "/seed") {
        this.ctx.storage.sql.exec(
          "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL, blob BLOB)"
        )
        this.ctx.storage.sql.exec("CREATE INDEX notes_body ON notes(body)")
        this.ctx.storage.sql.exec("CREATE TABLE numbers (value)")
        this.ctx.storage.sql.exec(
          "INSERT INTO numbers VALUES (1), (1.0), (NULL), ('1')"
        )
        this.ctx.storage.sql.exec("CREATE TABLE gaps (value TEXT)")
        this.ctx.storage.sql.exec(
          "INSERT INTO gaps(rowid,value) VALUES (7, 'seven'), (42, 'forty-two')"
        )
        this.ctx.storage.sql.exec(
          "INSERT INTO notes VALUES (?, ?, ?)",
          "one",
          "original",
          new Uint8Array([1, 0, 255]).buffer
        )
        await this.ctx.storage.put("settings", {
          theme: "dark",
          nested: [1, true, null],
        })
      }
      if (path === "/mutate") {
        this.ctx.storage.sql.exec("UPDATE notes SET body = 'changed'")
        this.ctx.storage.sql.exec("CREATE TABLE later (id INTEGER)")
        await this.ctx.storage.put("later", "delete-on-restore")
        await this.ctx.storage.put("settings", { theme: "light" })
      }
      if (path === "/large-integer")
        this.ctx.storage.sql.exec(
          "CREATE TABLE exact_integer(value INTEGER); INSERT INTO exact_integer VALUES (9223372036854775807)"
        )
      if (path === "/unsupported-kv")
        await this.ctx.storage.put("date", new Date())
      if (path === "/alarm")
        await this.ctx.storage.setAlarm(Date.now() + 600000)
      return new Response("ok")
    })
  }
}

export default {
  fetch(request: Request, environment: Environment) {
    return environment.OBJECT.get(
      environment.OBJECT.idFromName(
        request.headers.get("X-Test-Object") ?? "one"
      )
    ).fetch(request)
  },
}
