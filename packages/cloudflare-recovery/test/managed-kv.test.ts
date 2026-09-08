import { readFileSync } from "node:fs"
import { expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { Effect } from "effect"
import { ManagedKv, ManagedKvLive } from "../src/managed-kv"

test("managed KV follows restored D1 state despite stale cache, preserving bytes, metadata and expiration", async () => {
  const worker = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ready') } }",
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "application" },
  })
  try {
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
  } finally {
    await worker.dispose()
  }
})
