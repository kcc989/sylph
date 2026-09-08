import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import {
  RecoveryQueryInput,
  type RecoveryTopology,
} from "@workspace/domain/cloudflare-recovery"
import { CloudflareD1Recovery, CloudflareD1RecoveryLive } from "../src/recovery"
import {
  CloudflareRecoveryGroup,
  CloudflareRecoveryGroupLive,
} from "../src/group"

class Provider {
  control = new Database(":memory:")
  databases = new Map(
    ["one", "two"].map((id) => [id, new Database(":memory:")])
  )
  saved = new Map<string, Buffer>()
  revision = 1
  restored: string[] = []
  failDatabase = ""
  loseResponse = false
  topology: RecoveryTopology = {
    workers: [
      {
        workerName: "front",
        databaseIds: ["one"],
        secretNames: [],
        serviceTargets: ["back"],
      },
      {
        workerName: "back",
        databaseIds: ["two"],
        secretNames: [],
        serviceTargets: [],
      },
    ],
  }
  bindings = new Map(
    this.topology.workers.map((worker) => [
      worker.workerName,
      [
        ...worker.databaseIds.map((id) => ({ name: "DB", type: "d1", id })),
        { name: "SYLPH_RECOVERY_CONTROL", type: "d1", id: "control" },
        ...worker.serviceTargets.map((service) => ({
          name: "BACK",
          type: "service",
          service,
        })),
      ],
    ])
  )
  constructor() {
    this.control.exec(
      readFileSync(new URL("../src/control.sql", import.meta.url), "utf8")
    )
    for (const [id, database] of this.databases) {
      database.exec(
        "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)"
      )
      database
        .query("INSERT INTO notes VALUES (?, ?)")
        .run(id, `original-${id}`)
    }
  }
  database(id: string) {
    const database = id === "control" ? this.control : this.databases.get(id)
    if (!database) throw new Error("Unknown fixture database")
    return database
  }
  change() {
    this.revision++
    for (const [id, database] of this.databases)
      database.query("UPDATE notes SET body = ?").run(`changed-${id}`)
  }
  bodies() {
    return [...this.databases.values()].map((database) =>
      database.query("SELECT body FROM notes").get()
    )
  }
  fetch = async (url: string, init: RequestInit) => {
    expect(url.startsWith("https://broker.example/accounts/account/")).toBe(
      true
    )
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer project-capability"
    )
    const path = new URL(url)
    const pieces = path.pathname.split("/")
    const workerName = pieces[5] ?? ""
    if (path.pathname.endsWith("/settings"))
      return Response.json({
        success: true,
        result: { bindings: this.bindings.get(workerName) },
      })
    if (path.pathname.endsWith("/schedules"))
      return Response.json({ success: true, result: { schedules: [] } })
    const id = pieces[5] ?? ""
    const database = this.database(id)
    if (path.pathname.endsWith("/query")) {
      const input = Schema.decodeUnknownSync(RecoveryQueryInput)(
        JSON.parse(String(init.body))
      )
      return Response.json({
        success: true,
        result: [
          {
            success: true,
            results: database.query(input.sql).all(...input.params),
          },
        ],
      })
    }
    if (path.pathname.endsWith("/bookmark")) {
      const bookmark = `${id}-${this.revision}`
      this.saved.set(bookmark, database.serialize())
      return Response.json({ success: true, result: { bookmark } })
    }
    if (path.pathname.endsWith("/restore")) {
      this.restored.push(id)
      if (id === this.failDatabase && !this.loseResponse)
        return new Response("fixture restore unavailable", { status: 503 })
      const saved = this.saved.get(path.searchParams.get("bookmark") ?? "")
      if (!saved) throw new Error("Unknown fixture bookmark")
      this.databases.set(id, Database.deserialize(saved))
      if (id === this.failDatabase && this.loseResponse)
        throw new Error("Transport lost after accepted restore")
      return Response.json({
        success: true,
        result: { bookmark: `${id}-restored`, previous_bookmark: `${id}-undo` },
      })
    }
    throw new Error("Unexpected fixture API request")
  }
  layer() {
    const configuration = {
      accountId: "account",
      apiToken: "project-capability",
      apiBaseUrl: "https://broker.example/accounts/account",
      controlDatabaseId: "control",
      projectId: "project",
      encryptionKey: btoa("k".repeat(32)),
      fetch: this.fetch,
      topology: this.topology,
      drainTimeoutMs: 0,
    }
    return CloudflareRecoveryGroupLive(configuration).pipe(
      Layer.provideMerge(CloudflareD1RecoveryLive(configuration))
    )
  }
}

const run = <A, E>(
  provider: Provider,
  program: (
    group: CloudflareRecoveryGroup["Service"],
    recovery: CloudflareD1Recovery["Service"]
  ) => Effect.Effect<A, E>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* program(
        yield* CloudflareRecoveryGroup,
        yield* CloudflareD1Recovery
      )
    }).pipe(Effect.provide(provider.layer()))
  )

const prepare = (provider: Provider) =>
  run(provider, (group, recovery) =>
    Effect.gen(function* () {
      yield* recovery.pause("baseline")
      const target = yield* group.captureForDrill({ releaseId: "baseline" })
      yield* recovery.resume("baseline")
      provider.change()
      yield* recovery.pause("restore")
      const undo = yield* group.captureForDrill({ releaseId: "restore" })
      return { target, undo }
    })
  )

describe("coordinated application recovery", () => {
  test("restores and independently verifies two databases, then restores the complete undo group", async () => {
    const provider = new Provider()
    const { target, undo } = await prepare(provider)
    await run(provider, (group, recovery) =>
      Effect.gen(function* () {
        yield* group.restore(target.id, "restore")
        expect(provider.bodies()).toEqual([
          { body: "original-one" },
          { body: "original-two" },
        ])
        yield* recovery.resume("restore")
        yield* recovery.pause("undo")
        provider.revision++
        yield* group.capture({ releaseId: "undo" })
        yield* group.restore(undo.id, "undo")
        yield* recovery.resume("undo")
      })
    )
    expect(provider.bodies()).toEqual([
      { body: "changed-one" },
      { body: "changed-two" },
    ])
    expect(provider.restored).toEqual(["one", "two", "one", "two"])
    expect(
      provider.control.query("SELECT owner FROM sylph_recovery_gate").get()
    ).toEqual({ owner: null })
  })

  test.each([false, true])(
    "a later restore failure keeps the whole application paused, including lost responses: %s",
    async (lost) => {
      const provider = new Provider()
      const { target } = await prepare(provider)
      provider.failDatabase = "two"
      provider.loseResponse = lost
      await expect(
        run(provider, (group) => group.restore(target.id, "restore"))
      ).rejects.toThrow()
      expect(
        provider.control
          .query("SELECT phase FROM sylph_recovery_group_operation")
          .get()
      ).toEqual({ phase: "uncertain" })
      expect(provider.restored).toEqual(["one", "two"])
      await expect(
        run(provider, (group) => group.restore(target.id, "restore"))
      ).rejects.toThrow()
      await expect(
        run(provider, (_group, recovery) => recovery.resume("restore"))
      ).rejects.toThrow()
      expect(provider.restored).toEqual(["one", "two"])
      expect(
        provider.control.query("SELECT owner FROM sylph_recovery_gate").get()
      ).toEqual({ owner: "restore" })
    }
  )

  test("preflights every immutable member before the first destructive request", async () => {
    const provider = new Provider()
    const { target } = await prepare(provider)
    provider.control
      .query(
        "UPDATE sylph_recovery_manifest SET json = '{}' WHERE database_id = ? AND release_id = ?"
      )
      .run("two", "baseline")
    await expect(
      run(provider, (group) => group.restore(target.id, "restore"))
    ).rejects.toThrow()
    expect(provider.restored).toEqual([])
  })

  test("changed current data cannot use a stale undo group", async () => {
    const provider = new Provider()
    const { target } = await prepare(provider)
    provider.database("two").exec("UPDATE notes SET body = 'unrecorded'")
    await expect(
      run(provider, (group) => group.restore(target.id, "restore"))
    ).rejects.toThrow()
    expect(provider.restored).toEqual([])
  })

  test("a partial undo capture cannot authorize restoration", async () => {
    const provider = new Provider()
    const { target } = await prepare(provider)
    provider.control
      .query("DELETE FROM sylph_recovery_group WHERE release_id = ?")
      .run("restore")
    await expect(
      run(provider, (group) => group.restore(target.id, "restore"))
    ).rejects.toThrow()
    expect(provider.restored).toEqual([])
  })

  test("a changed Worker topology cannot use a prior group", async () => {
    const provider = new Provider()
    const { target } = await prepare(provider)
    provider.topology = { workers: [...provider.topology.workers].reverse() }
    await expect(
      run(provider, (group) => group.restore(target.id, "restore"))
    ).rejects.toThrow()
    expect(provider.restored).toEqual([])
  })

  test("every Worker must bind the shared gate and service targets must stay inside the group", async () => {
    const provider = new Provider()
    provider.bindings.set("back", [{ name: "DB", type: "d1", id: "two" }])
    await expect(
      run(provider, (group, recovery) =>
        Effect.gen(function* () {
          yield* recovery.pause("capture")
          yield* group.captureForDrill({ releaseId: "capture" })
        })
      )
    ).rejects.toThrow()
    expect(provider.saved.size).toBe(0)
  })

  test("upgrading a deployed recovery control database preserves earlier restore evidence", async () => {
    const provider = new Provider()
    provider.control.exec(
      "DROP TABLE sylph_recovery_resource_operation; DROP TABLE sylph_recovery_group; DROP TABLE sylph_recovery_group_operation"
    )
    provider.control.exec(
      "INSERT INTO sylph_recovery_operation VALUES ('legacy', 'point', 'schema', 'uncertain', NULL)"
    )
    const upgrade = readFileSync(
      new URL("../src/control-upgrade.sql", import.meta.url),
      "utf8"
    )
    provider.control.exec(upgrade)
    provider.control.exec(upgrade)
    await run(provider, (_group, recovery) => recovery.pause("legacy"))
    await expect(
      run(provider, (_group, recovery) => recovery.resume("legacy"))
    ).rejects.toThrow()
    expect(
      provider.control.query("SELECT phase FROM sylph_recovery_operation").get()
    ).toEqual({ phase: "uncertain" })
  })
})
