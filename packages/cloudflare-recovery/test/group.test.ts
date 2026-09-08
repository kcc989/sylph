import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import {
  RecoveryQueryInput,
  type RecoveryTopology,
} from "@workspace/domain/cloudflare-recovery"
import { CloudflareD1Recovery, CloudflareD1RecoveryLive } from "../src/recovery"
import { CloudflareR2RecoveryLive } from "../src/r2"
import {
  CloudflareObjectRecoveryLive,
  objectSchemaFingerprint,
} from "../src/object"
import type { RecoveryObjectSnapshot } from "@workspace/domain/cloudflare-object-recovery"
import { R2Provider, r2Object } from "./fixtures/r2-provider"
import { verifyRecoveryDrill } from "../src/drill"
import {
  CloudflareRecoveryGroup,
  CloudflareRecoveryGroupLive,
} from "../src/group"

class Provider {
  control = new Database(":memory:")
  r2: R2Provider | undefined
  object: RecoveryObjectSnapshot | undefined
  objectRestores = 0
  databases = new Map(
    ["one", "two"].map((id) => [id, new Database(":memory:")])
  )
  saved = new Map<string, Buffer>()
  revision = 1
  restored: string[] = []
  failDatabase = ""
  unavailableBookmark = ""
  settingsStatus = 200
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
  addBucket() {
    this.r2 = new R2Provider(this.control, "project-capability")
    this.topology = {
      workers: this.topology.workers.map((worker, index) => ({
        ...worker,
        bucketNames: index === 0 ? ["owned-bucket"] : undefined,
      })),
    }
    return this.r2
  }
  change() {
    if (this.object)
      this.object = {
        ...this.object,
        values: [{ key: "state", value: "changed" }],
      }
    this.revision++
    if (this.r2) {
      this.r2.objects.set(
        "folder/a #雪",
        r2Object("folder/a #雪", "new-object")
      )
      this.r2.objects.set("extra", r2Object("extra", "new-key"))
      this.r2.generation++
    }
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
    if (path.pathname.endsWith("/objects"))
      return Response.json({
        success: true,
        result: [{ id: "object", hasStoredData: true }],
        result_info: {},
      })
    if (path.pathname.endsWith("/queues"))
      return Response.json({
        success: true,
        result: [],
        result_info: { page: 1, total_pages: 0, total_count: 0 },
      })
    if (path.pathname.endsWith("/settings") && this.settingsStatus !== 200)
      return new Response(null, { status: this.settingsStatus })
    if (path.pathname.endsWith("/settings"))
      return Response.json({
        success: true,
        result: {
          bindings: [
            ...(this.bindings.get(workerName) ?? []),
            ...(this.r2 && workerName === "front"
              ? [
                  {
                    name: "BUCKET",
                    type: "r2_bucket",
                    bucket_name: "owned-bucket",
                  },
                ]
              : []),
          ],
        },
      })
    if (path.pathname.endsWith("/schedules"))
      return Response.json({ success: true, result: { schedules: [] } })
    const id = pieces[5] ?? ""
    const database = this.database(id)
    if (path.pathname.endsWith("/query")) {
      const input = Schema.decodeUnknownSync(RecoveryQueryInput)(
        JSON.parse(String(init.body))
      )
      const results = database.query(input.sql).all(...input.params)
      if (id !== "control" && !/^SELECT/i.test(input.sql)) this.revision++
      return Response.json({
        success: true,
        result: [{ success: true, results }],
      })
    }
    if (path.pathname.endsWith("/bookmark")) {
      if (id === this.unavailableBookmark)
        return new Response(null, { status: 503 })
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
      this.revision++
      if (id === this.failDatabase && this.loseResponse)
        throw new Error("Transport lost after accepted restore")
      return Response.json({
        success: true,
        result: { bookmark: `${id}-restored`, previous_bookmark: `${id}-undo` },
      })
    }
    if (path.pathname.endsWith(`/database/${id}`))
      return Response.json({
        success: true,
        result: { uuid: id, name: `sylph-${"a".repeat(24)}-recovery-drill` },
      })
    throw new Error("Unexpected fixture API request")
  }
  configuration() {
    return {
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
  }
  layer() {
    const d1 = CloudflareD1RecoveryLive(this.configuration())
    const storage = this.r2
      ? Layer.merge(
          d1,
          CloudflareR2RecoveryLive({
            ...this.configuration(),
            bucketNames: ["owned-bucket"],
            fetch: this.r2.fetch,
          })
        )
      : d1
    const dependencies = this.object
      ? Layer.merge(
          storage,
          CloudflareObjectRecoveryLive({
            ...this.configuration(),
            identities: [{ namespaceId: "namespace", objectId: "object" }],
            transport: async (request) => {
              if (!this.object) throw new Error("Missing object fixture")
              if (request.operation === "restore") {
                this.objectRestores++
                this.object = request.snapshot
              }
              return { identity: request.identity, snapshot: this.object }
            },
          })
        )
      : storage
    return CloudflareRecoveryGroupLive(this.configuration()).pipe(
      Layer.provideMerge(dependencies)
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

describe("first-release recovery drill", () => {
  test("changes and restores only the named scratch database, then establishes matching schema proof", async () => {
    const provider = new Provider()
    const input = {
      databaseId: "two",
      applicationDatabaseId: "one",
      expectedName: `sylph-${"a".repeat(24)}-recovery-drill`,
      releaseId: "bootstrap-drill",
    }
    const evidence = await Effect.runPromise(
      verifyRecoveryDrill(provider.configuration(), input).pipe(
        Effect.provide(provider.layer())
      )
    )
    expect(provider.restored).toEqual(["two"])
    expect(provider.bodies()).toEqual([
      { body: "original-one" },
      { body: "original-two" },
    ])
    expect(
      provider
        .database("two")
        .query(
          "SELECT name FROM sqlite_schema WHERE name = 'sylph_recovery_drill_probe'"
        )
        .all()
    ).toEqual([])
    const proof = await run(provider, (_group, recovery) =>
      recovery.restoreProof(evidence.schemaFingerprint)
    )
    expect(proof.databaseId).toBe("two")
    expect(
      provider.control.query("SELECT owner FROM sylph_recovery_gate").get()
    ).toEqual({ owner: null })
  })

  test("rejects application identity, foreign name, and mismatched schema before any restore", async () => {
    const provider = new Provider()
    for (const input of [
      {
        databaseId: "one",
        applicationDatabaseId: "one",
        expectedName: `sylph-${"a".repeat(24)}-recovery-drill`,
        releaseId: "drill",
      },
      {
        databaseId: "two",
        applicationDatabaseId: "one",
        expectedName: `sylph-${"b".repeat(24)}-recovery-drill`,
        releaseId: "drill",
      },
    ])
      await expect(
        Effect.runPromise(
          verifyRecoveryDrill(provider.configuration(), input).pipe(
            Effect.provide(provider.layer())
          )
        )
      ).rejects.toThrow()
    provider.database("two").exec("CREATE TABLE extra (id INTEGER)")
    await expect(
      Effect.runPromise(
        verifyRecoveryDrill(provider.configuration(), {
          databaseId: "two",
          applicationDatabaseId: "one",
          expectedName: `sylph-${"a".repeat(24)}-recovery-drill`,
          releaseId: "drill",
        }).pipe(Effect.provide(provider.layer()))
      )
    ).rejects.toThrow()
    expect(provider.restored).toEqual([])
  })
})

test("initial group capture requires a verified schema drill and independently absent Workers", async () => {
  const provider = new Provider()
  await Effect.runPromise(
    verifyRecoveryDrill(provider.configuration(), {
      databaseId: "two",
      applicationDatabaseId: "one",
      expectedName: `sylph-${"a".repeat(24)}-recovery-drill`,
      releaseId: "drill",
    }).pipe(Effect.provide(provider.layer()))
  )
  await run(provider, (_group, recovery) => recovery.pause("initial"))
  for (const status of [200, 403, 500]) {
    provider.settingsStatus = status
    await expect(
      run(provider, (group) => group.captureInitial({ releaseId: "initial" }))
    ).rejects.toThrow()
  }
  expect(
    provider.control.query("SELECT id FROM sylph_recovery_group").all()
  ).toEqual([])
  provider.settingsStatus = 404
  const group = await run(provider, (group) =>
    group.captureInitial({ releaseId: "initial" })
  )
  expect(group.databases.map((database) => database.databaseId)).toEqual([
    "one",
    "two",
  ])
})

describe("coordinated D1 and R2 recovery", () => {
  test("restores complete data and object metadata together, then restores their undo group", async () => {
    const provider = new Provider()
    const r2 = provider.addBucket()
    const original = new Map(r2.objects)
    const { target, undo } = await prepare(provider)
    const changed = new Map(r2.objects)
    expect(target.buckets).toHaveLength(1)
    await run(provider, (group, recovery) =>
      Effect.gen(function* () {
        yield* group.restore(target.id, "restore")
        yield* recovery.resume("restore")
        expect(provider.bodies()).toEqual([
          { body: "original-one" },
          { body: "original-two" },
        ])
        expect(r2.objects).toEqual(original)
        yield* recovery.pause("undo")
        yield* group.capture({ releaseId: "undo" })
        yield* group.restore(undo.id, "undo")
        yield* recovery.resume("undo")
        expect(provider.bodies()).toEqual([
          { body: "changed-one" },
          { body: "changed-two" },
        ])
        expect(r2.objects).toEqual(changed)
      })
    )
  })
  test("authenticates every bucket snapshot before the first database restore", async () => {
    const provider = new Provider()
    const r2 = provider.addBucket()
    const { target } = await prepare(provider)
    r2.corruptChunk = true
    await expect(
      run(provider, (group) => group.restore(target.id, "restore"))
    ).rejects.toThrow()
    expect(provider.restored).toEqual([])
    expect(r2.mutations).toBe(0)
  })
  test("refuses a stale bucket undo before restoring databases", async () => {
    const provider = new Provider()
    const r2 = provider.addBucket()
    const { target } = await prepare(provider)
    r2.objects.set("late", r2Object("late", "outside-writer"))
    r2.generation++
    await expect(
      run(provider, (group) => group.restore(target.id, "restore"))
    ).rejects.toThrow()
    expect(provider.restored).toEqual([])
    expect(r2.mutations).toBe(0)
  })
  test("a lost bucket restore response keeps the whole application paused without replay", async () => {
    const provider = new Provider()
    const r2 = provider.addBucket()
    const { target } = await prepare(provider)
    r2.lostMutation = 1
    await expect(
      run(provider, (group) => group.restore(target.id, "restore"))
    ).rejects.toThrow()
    expect(provider.restored).toEqual(["one", "two"])
    const mutations = r2.mutations
    await expect(
      run(provider, (group) => group.restore(target.id, "restore"))
    ).rejects.toThrow()
    expect(r2.mutations).toBe(mutations)
    await expect(
      run(provider, (_, recovery) => recovery.resume("restore"))
    ).rejects.toThrow()
    expect(
      provider.control
        .query(
          "SELECT phase FROM sylph_recovery_group_operation WHERE release_id = 'restore'"
        )
        .get()
    ).toEqual({ phase: "uncertain" })
  })
})

test.each(["prior-operation", "unavailable-bookmark"])(
  "group preflights later D1 member before all restore mutations: %s",
  async (mode) => {
    const provider = new Provider()
    const { target } = await prepare(provider)
    if (mode === "prior-operation")
      provider.control
        .query(
          "INSERT INTO sylph_recovery_resource_operation (release_id, resource_kind, resource_id, manifest_id, schema_fingerprint, phase) VALUES ('restore', 'd1', 'two', ?, ?, 'uncertain')"
        )
        .run(
          target.databases[1]?.id ?? "missing",
          target.databases[1]?.schemaFingerprint ?? "missing"
        )
    else provider.unavailableBookmark = "two"
    await expect(
      run(provider, (group) => group.restore(target.id, "restore"))
    ).rejects.toThrow()
    expect(provider.restored).toEqual([])
  }
)

const withObject = async () => {
  const provider = new Provider()
  provider.object = {
    version: 1,
    tables: [],
    indexes: [],
    values: [{ key: "state", value: "original" }],
  }
  provider.control.exec(
    readFileSync(new URL("../src/object-control.sql", import.meta.url), "utf8")
  )
  provider.control
    .query(
      "INSERT INTO sylph_recovery_object_drill (namespace_id, object_id, schema_fingerprint, verified_at, manifest_id) VALUES (?, ?, ?, ?, ?)"
    )
    .run(
      "namespace",
      "object",
      await objectSchemaFingerprint(provider.object),
      Date.now() - 1,
      "fixture-drill-manifest"
    )
  provider.control
    .query(
      "INSERT INTO sylph_recovery_object_drill_operation (namespace_id, release_id, phase) VALUES (?, ?, ?)"
    )
    .run("namespace", "fixture-drill", "verified")
  provider.topology = {
    workers: provider.topology.workers.map((worker) =>
      worker.workerName === "front"
        ? {
            ...worker,
            durableObjects: [
              {
                bindingName: "OBJECT",
                namespaceId: "namespace",
                objectIds: ["object"],
              },
            ],
          }
        : worker
    ),
  }
  provider.bindings.set("front", [
    ...(provider.bindings.get("front") ?? []),
    JSON.parse(
      '{"name":"OBJECT","type":"durable_object_namespace","namespace_id":"namespace"}'
    ),
  ])
  return provider
}

test("group authenticates object snapshots before D1 writes and restores registered state", async () => {
  const provider = await withObject()
  const { target } = await prepare(provider)
  await run(provider, (group) => group.restore(target.id, "restore"))
  expect(provider.objectRestores).toBe(1)
  expect(provider.object?.values).toEqual([{ key: "state", value: "original" }])
  expect(provider.restored).toEqual(["one", "two"])
})

test("corrupt object ciphertext prevents every grouped restore mutation", async () => {
  const provider = await withObject()
  const { target } = await prepare(provider)
  const manifest = target.objects?.[0]
  if (!manifest) throw new Error("Object manifest missing")
  provider.control
    .query(
      "UPDATE sylph_recovery_object_chunk SET ciphertext = 'corrupt' WHERE manifest_id = ?"
    )
    .run(manifest.id)
  await expect(
    run(provider, (group) => group.restore(target.id, "restore"))
  ).rejects.toThrow()
  expect(provider.restored).toEqual([])
  expect(provider.objectRestores).toBe(0)
})

test("group capture refuses object fixtures without verified drill proof", async () => {
  const provider = await withObject()
  provider.control.exec("DELETE FROM sylph_recovery_object_drill_operation")
  await expect(prepare(provider)).rejects.toThrow()
  expect(provider.objectRestores).toBe(0)
  expect(provider.restored).toEqual([])
})
