import { readFileSync } from "node:fs"
import { afterAll, beforeAll, expect, test } from "bun:test"
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
  type ObjectRecoveryConfiguration,
} from "../src/object"
import { verifyObjectRecoveryDrill } from "../src/object-drill"

import { objectWorkerScript } from "./fixtures/object-build"

const runtime = new Miniflare({
  modules: true,
  script: objectWorkerScript,
  compatibilityDate: "2026-08-01",
  d1Databases: { CONTROL: "control" },
  durableObjects: { OBJECT: { className: "TestObject", useSQLite: true } },
})
beforeAll(async () => {
  await runtime.ready
}, 30_000)
afterAll(() => runtime.dispose(), 30_000)

const setup = async () => {
  const objectName = crypto.randomUUID()
  const fetchObject = (path: string, body?: RecoveryObjectRequest) =>
    runtime.dispatchFetch(`https://object.test/${path}`, {
      method: body ? "POST" : "GET",
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        "X-Test-Object": objectName,
        "Content-Type": "application/json",
      },
    })
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
    .prepare("UPDATE sylph_recovery_gate SET owner = 'bootstrap', active = 0")
    .run()
  for (const table of [
    "sylph_recovery_object_manifest",
    "sylph_recovery_object_chunk",
    "sylph_recovery_object_operation",
    "sylph_recovery_object_drill",
    "sylph_recovery_object_drill_operation",
  ])
    await database.prepare(`DELETE FROM ${table}`).run()
  const identity = {
    namespaceId: "namespace",
    objectId: await (await fetchObject("id")).text(),
  }
  const state = {
    clock: Date.now(),
    hasStoredData: false,
    failProofFinalization: false,
    loseResponseAt: 0,
    ignoreRestoreAt: 0,
    loseGateAt: 0,
    restores: 0,
    captures: 0,
    listingCalls: 0,
    observed: new Array<RecoveryObjectResponse>(),
  }
  const transport = async (request: RecoveryObjectRequest) => {
    state.clock++
    if (request.operation === "restore") state.restores++
    else state.captures++
    const submitted: RecoveryObjectRequest =
      request.operation === "restore" &&
      state.ignoreRestoreAt === state.restores
        ? {
            operation: "capture",
            identity: request.identity,
            releaseId: request.releaseId,
          }
        : request
    const response = await fetchObject("recovery", submitted)
    if (!response.ok) throw new Error("Object rejected recovery")
    const result = Schema.decodeUnknownSync(RecoveryObjectResponse)(
      await response.json()
    )
    state.observed.push(result)
    if (request.operation === "restore" && state.loseGateAt === state.restores)
      await database
        .prepare("UPDATE sylph_recovery_gate SET owner = 'changed-owner'")
        .run()
    if (
      request.operation === "restore" &&
      state.loseResponseAt === state.restores
    )
      throw new Error("Lost response after completed object mutation")
    return result
  }
  const configuration: ObjectRecoveryConfiguration = {
    accountId: "account",
    apiToken: "test-token",
    projectId: "project",
    controlDatabaseId: "control",
    encryptionKey: btoa("k".repeat(32)),
    identities: [identity],
    now: () => state.clock,
    transport,
    fetch: async (url, init) => {
      if (new URL(url).pathname.endsWith("/objects")) {
        state.listingCalls++
        return Response.json({
          success: true,
          result: state.hasStoredData
            ? [{ id: identity.objectId, hasStoredData: true }]
            : [],
          result_info: {},
        })
      }
      const input = Schema.decodeUnknownSync(RecoveryQueryInput)(
        JSON.parse(String(init.body))
      )
      if (
        state.failProofFinalization &&
        input.sql.startsWith(
          "UPDATE sylph_recovery_object_drill_operation SET phase = 'verified'"
        )
      )
        throw new Error("Lost proof finalization")
      const result = await database
        .prepare(input.sql)
        .bind(...input.params)
        .all()
      return Response.json({ success: true, result: [result] })
    },
  }
  const layer = CloudflareObjectRecoveryLive(configuration)
  const drill = () =>
    Effect.runPromise(
      verifyObjectRecoveryDrill(configuration, "namespace", "bootstrap").pipe(
        Effect.provide(layer)
      )
    )
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
  return { state, identity, database, transport, run, fetchObject, drill }
}

test("initial drill observes a real object mutation and restore before admitting ordinary captures", async () => {
  const fixture = await setup()
  const { state, identity, database, run, drill } = fixture
  await expect(
    run((objects) => objects.capture(identity, "bootstrap"))
  ).rejects.toThrow()
  expect(
    await database
      .prepare("SELECT COUNT(*) AS count FROM sylph_recovery_object_manifest")
      .first<number>("count")
  ).toBe(0)
  const startedAt = state.clock
  await drill()
  expect(state.listingCalls).toBe(1)
  expect(state.restores).toBe(2)
  expect(
    state.observed.some((response) =>
      response.snapshot.tables.some(
        (table) =>
          table.name.startsWith("sylph_drill_") && table.rows.length > 0
      )
    )
  ).toBe(true)
  expect(state.observed.at(-1)?.snapshot).toEqual({
    version: 1,
    tables: [],
    indexes: [],
    values: [],
  })
  const proof = Schema.decodeUnknownSync(Schema.Number)(
    await database
      .prepare(
        "SELECT verified_at FROM sylph_recovery_object_drill WHERE object_id = ?"
      )
      .bind(identity.objectId)
      .first<number>("verified_at")
  )
  expect(proof).toBe(state.clock)
  expect(proof).toBeGreaterThan(startedAt)
  const saved = await run((objects) => objects.capture(identity, "bootstrap"))
  expect(saved.restoreVerifiedAt).toBe(proof)
  expect(saved.capturedAt).toBeGreaterThan(saved.restoreVerifiedAt)
  expect(
    await database
      .prepare("SELECT phase FROM sylph_recovery_object_drill_operation")
      .first<string>("phase")
  ).toBe("verified")
  expect(
    await database
      .prepare("SELECT owner FROM sylph_recovery_gate")
      .first<string>("owner")
  ).toBe("bootstrap")
  await expect(drill()).rejects.toThrow()
  expect(state.restores).toBe(2)
})

test("populated provider namespaces fail before every object mutation", async () => {
  const fixture = await setup()
  fixture.state.hasStoredData = true
  await expect(fixture.drill()).rejects.toThrow()
  expect(fixture.state.restores).toBe(0)
  expect(fixture.state.captures).toBe(0)
  expect(
    await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM sylph_recovery_object_drill")
      .first<number>("count")
  ).toBe(0)
})

test("prior saved object work cannot be reclassified as a fresh initial drill", async () => {
  const fixture = await setup()
  await fixture.run((objects) =>
    objects.captureForDrill(fixture.identity, "bootstrap")
  )
  await expect(fixture.drill()).rejects.toThrow()
  expect(fixture.state.restores).toBe(0)
  expect(
    await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM sylph_recovery_object_drill")
      .first<number>("count")
  ).toBe(0)
})

test.each([1, 2])(
  "a lost response after actual object mutation %s cannot produce proof or retry",
  async (mutation) => {
    const fixture = await setup()
    fixture.state.loseResponseAt = mutation
    await expect(fixture.drill()).rejects.toThrow()
    expect(fixture.state.restores).toBe(mutation)
    await expect(fixture.drill()).rejects.toThrow()
    expect(fixture.state.restores).toBe(mutation)
    expect(
      await fixture.database
        .prepare("SELECT COUNT(*) AS count FROM sylph_recovery_object_drill")
        .first<number>("count")
    ).toBe(0)
    expect(
      await fixture.database
        .prepare("SELECT phase FROM sylph_recovery_object_drill_operation")
        .first<string>("phase")
    ).toBe("uncertain")
    expect(
      await fixture.database
        .prepare("SELECT owner FROM sylph_recovery_gate")
        .first<string>("owner")
    ).toBe("bootstrap")
  }
)

test("losing the gate after a real probe write stops further mutation and proof", async () => {
  const fixture = await setup()
  fixture.state.loseGateAt = 1
  await expect(fixture.drill()).rejects.toThrow()
  expect(fixture.state.restores).toBe(1)
  expect(
    await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM sylph_recovery_object_drill")
      .first<number>("count")
  ).toBe(0)
  expect(
    await fixture.database
      .prepare("SELECT phase FROM sylph_recovery_object_drill_operation")
      .first<string>("phase")
  ).toBe("uncertain")
  expect(
    await fixture.database
      .prepare("SELECT owner FROM sylph_recovery_gate")
      .first<string>("owner")
  ).toBe("changed-owner")
  await expect(fixture.drill()).rejects.toThrow()
  expect(fixture.state.restores).toBe(1)
})

test("proof rows left by failed namespace finalization cannot authorize normal capture", async () => {
  const fixture = await setup()
  fixture.state.failProofFinalization = true
  await expect(fixture.drill()).rejects.toThrow()
  expect(fixture.state.restores).toBe(2)
  expect(
    await fixture.database
      .prepare("SELECT COUNT(*) AS count FROM sylph_recovery_object_drill")
      .first<number>("count")
  ).toBe(1)
  expect(
    await fixture.database
      .prepare("SELECT phase FROM sylph_recovery_object_drill_operation")
      .first<string>("phase")
  ).toBe("uncertain")
  await expect(
    fixture.run((objects) => objects.capture(fixture.identity, "bootstrap"))
  ).rejects.toThrow()
  expect(
    await fixture.database
      .prepare("SELECT owner FROM sylph_recovery_gate")
      .first<string>("owner")
  ).toBe("bootstrap")
  await expect(fixture.drill()).rejects.toThrow()
  expect(fixture.state.restores).toBe(2)
})

test.each([1, 2])(
  "successful acknowledgments without mutation %s cannot become restore proof",
  async (mutation) => {
    const fixture = await setup()
    fixture.state.ignoreRestoreAt = mutation
    await expect(fixture.drill()).rejects.toThrow()
    expect(fixture.state.restores).toBe(mutation)
    expect(
      await fixture.database
        .prepare("SELECT COUNT(*) AS count FROM sylph_recovery_object_drill")
        .first<number>("count")
    ).toBe(0)
    expect(
      await fixture.database
        .prepare("SELECT owner FROM sylph_recovery_gate")
        .first<string>("owner")
    ).toBe("bootstrap")
    await expect(fixture.drill()).rejects.toThrow()
    expect(fixture.state.restores).toBe(mutation)
  }
)
