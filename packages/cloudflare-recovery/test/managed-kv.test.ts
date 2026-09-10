import { readFileSync } from "node:fs"
import { afterAll, beforeEach, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { Effect } from "effect"
import { ManagedKv, ManagedKvLive } from "../src/managed-kv"

const worker = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('ready') } }",
  compatibilityDate: "2026-08-01",
  d1Databases: { DB: "application" },
})
afterAll(() => worker.dispose())
beforeEach(async () => {
  const database = await worker.getD1Database("DB")
  for (const table of ["sylph_managed_kv", "saved", "before_restore"])
    await database.prepare(`DROP TABLE IF EXISTS ${table}`).run()
})

test("managed KV follows restored D1 state despite stale cache, preserving bytes, metadata and expiration", async () => {
  const database = await worker.getD1Database("DB")
  await database
    .prepare(
      readFileSync(new URL("../src/managed-kv.sql", import.meta.url), "utf8")
    )
    .run()
  const cache = new Map<string, string>()
  let time = 1000000
  const layer = ManagedKvLive({
    database,
    cache: {
      get: async (key) => cache.get(key) ?? "stale",
      put: async (key, value) => {
        cache.set(key, value)
      },
    },
    namespace: "files",
    now: () => time,
  })
  const run = <A>(effect: Effect.Effect<A, unknown, ManagedKv>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)))
  await run(
    Effect.gen(function* () {
      const kv = yield* ManagedKv
      yield* kv.put({
        key: "binary",
        value: new Uint8Array([0, 255, 42]),
        metadata: { contentType: "application/octet-stream" },
        expiration: 1100,
      })
      yield* kv.put({ key: "deleted", value: new Uint8Array([1]) })
    })
  )
  await database.exec("CREATE TABLE saved AS SELECT * FROM sylph_managed_kv")
  await run(
    Effect.gen(function* () {
      const kv = yield* ManagedKv
      yield* kv.put({
        key: "binary",
        value: new Uint8Array([9]),
        metadata: { changed: true },
      })
      yield* kv.delete("deleted")
      yield* kv.put({ key: "later", value: new Uint8Array([2]) })
    })
  )
  await database.exec(
    "CREATE TABLE before_restore AS SELECT * FROM sylph_managed_kv"
  )
  await database.batch([
    database.prepare("DELETE FROM sylph_managed_kv"),
    database.prepare("INSERT INTO sylph_managed_kv SELECT * FROM saved"),
  ])
  for (const key of cache.keys()) cache.set(key, "corrupt")
  const restored = await run(
    Effect.gen(function* () {
      return yield* (yield* ManagedKv).get("binary")
    })
  )
  expect(restored?.value).toEqual(new Uint8Array([0, 255, 42]))
  expect(restored?.metadata).toEqual({
    contentType: "application/octet-stream",
  })
  expect(restored?.expiration).toBe(1100)
  expect(
    await run(
      Effect.gen(function* () {
        return yield* (yield* ManagedKv).list()
      })
    )
  ).toEqual(["binary", "deleted"])
  time = 1100000
  expect(
    await run(
      Effect.gen(function* () {
        return yield* (yield* ManagedKv).get("binary")
      })
    )
  ).toBeNull()
  expect(
    await run(
      Effect.gen(function* () {
        return yield* (yield* ManagedKv).get("later")
      })
    )
  ).toBeNull()
  await database.batch([
    database.prepare("DELETE FROM sylph_managed_kv"),
    database.prepare(
      "INSERT INTO sylph_managed_kv SELECT * FROM before_restore"
    ),
  ])
  const undone = await run(
    Effect.gen(function* () {
      const kv = yield* ManagedKv
      return {
        binary: yield* kv.get("binary"),
        deleted: yield* kv.get("deleted"),
        later: yield* kv.get("later"),
      }
    })
  )
  expect(undone.binary?.value).toEqual(new Uint8Array([9]))
  expect(undone.binary?.metadata).toEqual({ changed: true })
  expect(undone.binary?.expiration).toBeNull()
  expect(undone.deleted).toBeNull()
  expect(undone.later?.value).toEqual(new Uint8Array([2]))
  await expect(
    run(
      Effect.gen(function* () {
        yield* (yield* ManagedKv).put({
          key: "bad",
          value: new Uint8Array(1024 * 1024 + 1),
        })
      })
    )
  ).rejects.toThrow("Managed KV operation failed")
})

test("cache outage preserves acknowledged writes, reads and deletes", async () => {
  const database = await worker.getD1Database("DB")
  await database
    .prepare(
      readFileSync(new URL("../src/managed-kv.sql", import.meta.url), "utf8")
    )
    .run()
  const layer = ManagedKvLive({
    database,
    namespace: "outage",
    now: () => 1000000,
    cache: {
      get: async () => {
        throw new Error("cache unavailable")
      },
      put: async () => {
        throw new Error("cache unavailable")
      },
    },
  })
  const run = <A>(effect: Effect.Effect<A, unknown, ManagedKv>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)))
  await run(
    Effect.gen(function* () {
      const kv = yield* ManagedKv
      yield* kv.put({
        key: "é".repeat(256),
        value: new Uint8Array([0, 255]),
        metadata: { unicode: "é" },
        expiration: 1001,
      })
      expect((yield* kv.get("é".repeat(256)))?.value).toEqual(
        new Uint8Array([0, 255])
      )
      expect(yield* kv.list()).toEqual(["é".repeat(256)])
      const largest = new Uint8Array(1024 * 1024).fill(255)
      yield* kv.put({
        key: "maximum",
        value: largest,
        metadata: "a".repeat(1022),
      })
      const maximum = yield* kv.get("maximum")
      expect(maximum?.value).toEqual(largest)
      expect(maximum?.metadata).toBe("a".repeat(1022))
      yield* kv.delete("maximum")
      yield* kv.delete("é".repeat(256))
      expect(yield* kv.get("é".repeat(256))).toBeNull()
    })
  )
  for (const invalid of [
    { key: "é".repeat(257), value: new Uint8Array([1]) },
    {
      key: "metadata",
      value: new Uint8Array([1]),
      metadata: { text: "é".repeat(512) },
    },
    { key: "expired", value: new Uint8Array([1]), expiration: 1000 },
    { key: "fraction", value: new Uint8Array([1]), expiration: 1000.5 },
  ]) {
    await expect(
      run(
        Effect.gen(function* () {
          yield* (yield* ManagedKv).put(invalid)
        })
      )
    ).rejects.toThrow("Managed KV operation failed")
  }
  expect(
    await run(
      Effect.gen(function* () {
        return yield* (yield* ManagedKv).list()
      })
    )
  ).toEqual([])
})

test("a concurrent update during cache fallback returns one complete revision", async () => {
  const database = await worker.getD1Database("DB")
  await database
    .prepare(
      readFileSync(new URL("../src/managed-kv.sql", import.meta.url), "utf8")
    )
    .run()
  const writer = ManagedKvLive({
    database,
    namespace: "concurrent",
    cache: { get: async () => null, put: async () => {} },
  })
  const write = (value: number) =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* (yield* ManagedKv).put({
          key: "item",
          value: new Uint8Array([value]),
          metadata: { revision: value },
        })
      }).pipe(Effect.provide(writer))
    )
  await write(1)
  let reads = 0
  const reader = ManagedKvLive({
    database,
    namespace: "concurrent",
    cache: {
      get: async () => {
        if (reads++ === 0) await write(2)
        return null
      },
      put: async () => {},
    },
  })
  const observed = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* ManagedKv).get("item")
    }).pipe(Effect.provide(reader))
  )
  expect(observed?.value).toEqual(new Uint8Array([2]))
  expect(observed?.metadata).toEqual({ revision: 2 })
  expect(reads).toBe(2)
})
