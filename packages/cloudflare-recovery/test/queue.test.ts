import { readFileSync } from "node:fs"
import { afterAll, expect, test } from "bun:test"
import { Effect } from "effect"
import { Miniflare } from "miniflare"
import type { RecoveryQueueNotification } from "@workspace/domain/cloudflare-queue-recovery"
import {
  CloudflareRecoveryQueue,
  CloudflareRecoveryQueueLive,
} from "../src/queue"

const worker = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('ok') } }",
  compatibilityDate: "2026-08-01",
  d1Databases: { DB: "application" },
})
afterAll(() => worker.dispose())

const setup = async () => {
  const database = await worker.getD1Database("DB")
  for (const sql of readFileSync(
    new URL("../src/queue.sql", import.meta.url),
    "utf8"
  )
    .split(";")
    .filter((value) => value.trim()))
    await database.prepare(sql).run()
  await database.prepare("DELETE FROM sylph_recovery_queue").run()
  await database.prepare("DROP TABLE IF EXISTS saved_journal").run()
  const sent: RecoveryQueueNotification[] = []
  let failSend = false
  const layer = CloudflareRecoveryQueueLive({
    database,
    queue: "jobs",
    transport: {
      send: async (body) => {
        if (failSend) throw new Error("transport unavailable")
        sent.push(body)
        return {
          metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
        }
      },
    },
  })
  const run = <A>(
    program: (
      queue: CloudflareRecoveryQueue["Service"]
    ) => Effect.Effect<A, unknown>
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* program(yield* CloudflareRecoveryQueue)
      }).pipe(Effect.provide(layer))
    )
  return {
    database,
    sent,
    run,
    failSend: () => {
      failSend = true
    },
    recoverSend: () => {
      failSend = false
    },
  }
}

test("a transport failure retains the message and replay publishes only its journal identity", async () => {
  const state = await setup()
  state.failSend()
  await expect(
    state.run((queue) =>
      queue.enqueue({ id: "one", body: { secret: "payload" } })
    )
  ).rejects.toThrow()
  expect(
    await state.database
      .prepare("SELECT COUNT(*) AS count FROM sylph_recovery_queue")
      .first<number>("count")
  ).toBe(1)
  state.recoverSend()
  expect(
    await state.run((queue) => queue.replayPending({ limit: 100 }))
  ).toEqual({ sent: 1, nextCursor: null })
  expect(state.sent).toEqual([{ version: 1, queue: "jobs", id: "one" }])
})

test("completed, absent, invalid and wrong-queue notifications cannot execute application work", async () => {
  const state = await setup()
  await state.run((queue) =>
    queue.enqueue({ id: "one", body: { task: "work" } })
  )
  let calls = 0
  const handle = async () => {
    calls++
  }
  const notification: RecoveryQueueNotification = {
    version: 1,
    queue: "jobs",
    id: "one",
  }
  expect(await state.run((queue) => queue.consume(notification, handle))).toBe(
    "completed"
  )
  expect(await state.run((queue) => queue.consume(notification, handle))).toBe(
    "ignored"
  )
  expect(
    await state.run((queue) =>
      queue.consume({ ...notification, id: "gone" }, handle)
    )
  ).toBe("ignored")
  await expect(
    state.run((queue) =>
      queue.consume({ ...notification, queue: "other" }, handle)
    )
  ).rejects.toThrow()
  await expect(
    state.run((queue) =>
      queue.consume(
        JSON.parse('{"version":2,"queue":"jobs","id":"one"}'),
        handle
      )
    )
  ).rejects.toThrow()
  expect(calls).toBe(1)
  await state.run((queue) =>
    queue.enqueue({ id: "one", body: { task: "work" } })
  )
  expect(state.sent).toHaveLength(1)
  await expect(
    state.run((queue) => queue.enqueue({ id: "one", body: "different" }))
  ).rejects.toThrow()
})

test("failed handlers remain pending and replay uses bounded pagination", async () => {
  const state = await setup()
  for (const id of ["a", "b", "c"])
    await state.run((queue) => queue.enqueue({ id, body: id }))
  await expect(
    state.run((queue) =>
      queue.consume(state.sent[0]!, async () => {
        throw new Error("failed")
      })
    )
  ).rejects.toThrow()
  expect(await state.run((queue) => queue.replayPending({ limit: 2 }))).toEqual(
    { sent: 2, nextCursor: "b" }
  )
  expect(
    await state.run((queue) => queue.replayPending({ limit: 2, afterId: "b" }))
  ).toEqual({ sent: 1, nextCursor: null })
  expect(
    await state.database
      .prepare(
        "SELECT COUNT(*) AS count FROM sylph_recovery_queue WHERE completed_at IS NULL"
      )
      .first<number>("count")
  ).toBe(3)
})

test("rewinding journal rows recovers pending messages without restoring queue transport contents", async () => {
  const state = await setup()
  await state.run((queue) =>
    queue.enqueue({ id: "before", body: "saved-body" })
  )
  await state.database
    .prepare("CREATE TABLE saved_journal AS SELECT * FROM sylph_recovery_queue")
    .run()
  await state.run((queue) => queue.consume(state.sent[0]!, async () => {}))
  await state.run((queue) =>
    queue.enqueue({ id: "after", body: "lost-after-restore" })
  )
  await state.database.batch([
    state.database.prepare("DELETE FROM sylph_recovery_queue"),
    state.database.prepare(
      "INSERT INTO sylph_recovery_queue SELECT * FROM saved_journal"
    ),
  ])
  const bodies: unknown[] = []
  expect(
    await state.run((queue) =>
      queue.consume(
        { version: 1, queue: "jobs", id: "after" },
        async (message) => {
          bodies.push(message.body)
        }
      )
    )
  ).toBe("ignored")
  expect(
    await state.run((queue) => queue.replayPending({ limit: 100 }))
  ).toEqual({ sent: 1, nextCursor: null })
  await state.run((queue) =>
    queue.consume(state.sent.at(-1)!, async (message) => {
      bodies.push(message.body)
    })
  )
  expect(bodies).toEqual(["saved-body"])
})

test("journal capacity and payload bounds fail without publishing unrecorded messages", async () => {
  const state = await setup()
  await expect(
    state.run((queue) =>
      queue.enqueue({ id: "large", body: "x".repeat(65537) })
    )
  ).rejects.toThrow()
  await state.database
    .prepare(
      "WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM ids WHERE n < 10000) INSERT INTO sylph_recovery_queue SELECT 'jobs', CAST(n AS TEXT), 'null', 1, NULL FROM ids"
    )
    .run()
  await expect(
    state.run((queue) => queue.enqueue({ id: "overflow", body: null }))
  ).rejects.toThrow()
  expect(state.sent).toHaveLength(0)
})
