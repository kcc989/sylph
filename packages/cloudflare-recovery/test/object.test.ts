import { readFileSync } from "node:fs"
import { afterAll, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Miniflare } from "miniflare"
import {
  RecoveryObjectResponse,
  type RecoveryObjectRequest,
} from "@workspace/domain/cloudflare-object-recovery"
import { RecoveryQueryInput } from "@workspace/domain/cloudflare-recovery"
import {
  CloudflareObjectRecovery,
  CloudflareObjectRecoveryLive,
} from "../src/object"

const build = await Bun.build({
  entrypoints: [
    new URL("./fixtures/object-worker.ts", import.meta.url).pathname,
  ],
  target: "browser",
  external: ["cloudflare:workers"],
})

if (!build.success || !build.outputs[0])
  throw new Error("Object fixture build failed")
const runtime = new Miniflare({
  modules: true,
  script: await build.outputs[0].text(),
  compatibilityDate: "2026-08-01",
  d1Databases: { CONTROL: "control" },
  durableObjects: { OBJECT: { className: "TestObject", useSQLite: true } },
})
afterAll(() => runtime.dispose())

const setup = async () => {
  const objectName = crypto.randomUUID()
  const worker = {
    dispatchFetch: (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set("X-Test-Object", objectName)
      return runtime.dispatchFetch(url, {
        method: init.method,
        body: init.body?.toString(),
        headers: Object.fromEntries(headers.entries()),
      })
    },
    dispose: async () => {},
  }
  const database = await runtime.getD1Database("CONTROL")
  for (const file of ["control.sql", "object-control.sql"])
    for (const sql of readFileSync(
      new URL(`../src/${file}`, import.meta.url),
      "utf8"
    )
      .split(";")
      .filter((line) => line.trim()))
      await database.prepare(sql).run()
  await database
    .prepare("UPDATE sylph_recovery_gate SET owner = NULL, active = 0")
    .run()
  for (const table of [
    "sylph_recovery_object_manifest",
    "sylph_recovery_object_chunk",
    "sylph_recovery_object_operation",
  ])
    await database.prepare(`DELETE FROM ${table}`).run()
  const identity = {
    namespaceId: "namespace",
    objectId: await (
      await worker.dispatchFetch("https://object.test/id")
    ).text(),
  }
  let lostResponse = false
  let restores = 0
  const transport = async (request: RecoveryObjectRequest) => {
    if (request.operation === "restore") restores++
    const response = await worker.dispatchFetch(
      "https://object.test/recovery",
      {
        method: "POST",
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
      }
    )
    if (!response.ok) throw new Error("Object rejected recovery")
    if (request.operation === "restore" && lostResponse)
      throw new Error("Lost object response")
    return Schema.decodeUnknownSync(RecoveryObjectResponse)(
      await response.json()
    )
  }
  const layer = CloudflareObjectRecoveryLive({
    accountId: "account",
    apiToken: "token",
    projectId: "project",
    controlDatabaseId: "control",
    encryptionKey: btoa("k".repeat(32)),
    identities: [identity],
    transport,
    fetch: async (_url, init) => {
      const input = Schema.decodeUnknownSync(RecoveryQueryInput)(
        JSON.parse(String(init.body))
      )
      const result = await database
        .prepare(input.sql)
        .bind(...input.params)
        .all()
      return Response.json({ success: true, result: [result] })
    },
  })
  const run = <A>(
    program: (
      objects: CloudflareObjectRecovery["Service"]
    ) => Effect.Effect<A, unknown>
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* program(yield* CloudflareObjectRecovery)
      }).pipe(Effect.provide(layer))
    )
  const pause = async (release: string | null) => {
    await database
      .prepare("UPDATE sylph_recovery_gate SET owner = ?")
      .bind(release)
      .run()
  }
  return {
    worker,
    database,
    identity,
    transport,
    run,
    pause,
    loseResponse: () => {
      lostResponse = true
    },
    restores: () => restores,
  }
}

test("actual SQLite object tables, indexes, blobs and JSON KV round-trip through encrypted recovery", async () => {
  const state = await setup()
  try {
    expect(
      (await state.worker.dispatchFetch("https://object.test/seed")).status
    ).toBe(200)
    await state.pause("original")
    const saved = await state.run((objects) =>
      objects.captureForDrill(state.identity, "original")
    )
    const original = await state.transport({
      operation: "capture",
      releaseId: "original",
      identity: state.identity,
    })
    expect(
      original.snapshot.tables.find((table) => table.name === "gaps")?.rows
    ).toEqual([
      ["42", "forty-two"],
      ["7", "seven"],
    ])
    expect(
      original.snapshot.tables.find((table) => table.name === "numbers")?.rows
    ).toEqual([
      ["1", { integer: 1 }],
      ["2", { real: 1 }],
      ["3", null],
      ["4", "1"],
    ])
    const chunks = await state.database
      .prepare("SELECT ciphertext FROM sylph_recovery_object_chunk")
      .all()
    expect(JSON.stringify(chunks)).not.toContain("original")
    await state.pause(null)
    expect(
      (await state.worker.dispatchFetch("https://object.test/mutate")).status
    ).toBe(200)
    await state.pause("restore")
    await state.run((objects) =>
      objects.captureForDrill(state.identity, "restore")
    )
    await state.run((objects) => objects.restore(saved, "restore"))
    expect(
      await state.transport({
        operation: "capture",
        releaseId: "restore",
        identity: state.identity,
      })
    ).toEqual(original)
    expect(
      await state.database
        .prepare("SELECT phase FROM sylph_recovery_object_operation")
        .first<string>("phase")
    ).toBe("verified")
    await expect(
      state.run((objects) => objects.restore(saved, "restore"))
    ).rejects.toThrow()
    expect(state.restores()).toBe(1)
  } finally {
    await state.worker.dispose()
  }
})

test("uncertain object restores retain pause and cannot replay a destructive request", async () => {
  const state = await setup()
  try {
    await state.worker.dispatchFetch("https://object.test/seed")
    await state.pause("original")
    const saved = await state.run((objects) =>
      objects.captureForDrill(state.identity, "original")
    )
    await state.pause(null)
    await state.worker.dispatchFetch("https://object.test/mutate")
    await state.pause("restore")
    await state.run((objects) =>
      objects.captureForDrill(state.identity, "restore")
    )
    state.loseResponse()
    await expect(
      state.run((objects) => objects.restore(saved, "restore"))
    ).rejects.toThrow()
    await expect(
      state.run((objects) => objects.restore(saved, "restore"))
    ).rejects.toThrow()
    expect(state.restores()).toBe(1)
    expect(
      await state.database
        .prepare("SELECT phase FROM sylph_recovery_object_operation")
        .first<string>("phase")
    ).toBe("uncertain")
    expect(
      await state.database
        .prepare("SELECT owner FROM sylph_recovery_gate")
        .first<string>("owner")
    ).toBe("restore")
  } finally {
    await state.worker.dispose()
  }
})

test("unregistered objects, wrong gate ownership and alarms cannot emit snapshots", async () => {
  const state = await setup()
  try {
    await expect(
      state.run((objects) => objects.captureForDrill(state.identity, "release"))
    ).rejects.toThrow()
    await state.worker.dispatchFetch("https://object.test/alarm")
    await state.pause("release")
    await expect(
      state.run((objects) =>
        objects.captureForDrill(
          { ...state.identity, objectId: "unknown" },
          "release"
        )
      )
    ).rejects.toThrow()
    await expect(
      state.run((objects) => objects.captureForDrill(state.identity, "release"))
    ).rejects.toThrow()
    expect(
      await state.database
        .prepare("SELECT COUNT(*) AS count FROM sylph_recovery_object_manifest")
        .first<number>("count")
    ).toBe(0)
  } finally {
    await state.worker.dispose()
  }
})

test.each(["large-integer", "unsupported-kv"])(
  "object capture refuses unrepresentable state: %s",
  async (path) => {
    const state = await setup()
    try {
      expect(
        (await state.worker.dispatchFetch(`https://object.test/${path}`)).status
      ).toBe(200)
      await state.pause("release")
      await expect(
        state.run((objects) =>
          objects.captureForDrill(state.identity, "release")
        )
      ).rejects.toThrow()
      expect(
        await state.database
          .prepare(
            "SELECT COUNT(*) AS count FROM sylph_recovery_object_manifest"
          )
          .first<number>("count")
      ).toBe(0)
    } finally {
      await state.worker.dispose()
    }
  }
)
