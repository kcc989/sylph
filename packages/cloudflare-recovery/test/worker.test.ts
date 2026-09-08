import { readFileSync } from "node:fs"
import { expect, test } from "bun:test"
import { Miniflare } from "miniflare"

const setup = async () => {
  const source = readFileSync(
    new URL("../src/worker.ts", import.meta.url),
    "utf8"
  )
  const entry = `
export default { fetch: withRecoveryGate(async (request, env, context) => {
  if (new URL(request.url).pathname === '/background') {
    context.waitUntil(new Promise(resolve => setTimeout(resolve, 80)).then(() => env.SYLPH_RECOVERY_CONTROL.prepare('INSERT INTO completed VALUES (1)').run()))
  }
  return new Response('application')
}, async () => new Response('verified-read-only')),
queue: withRecoveryQueueGate(async (batch, env, context) => {
  context.waitUntil(new Promise(resolve => setTimeout(resolve, 20)).then(() => env.SYLPH_RECOVERY_CONTROL.prepare('INSERT INTO completed VALUES (2)').run()))
}) }
`
  const worker = new Miniflare({
    modules: true,
    script: new Bun.Transpiler({ loader: "ts" }).transformSync(source + entry),
    compatibilityDate: "2026-08-01",
    d1Databases: { SYLPH_RECOVERY_CONTROL: "control" },
    bindings: { SYLPH_RECOVERY_VERIFY_TOKEN: "private-verifier" },
  })
  const database = await worker.getD1Database("SYLPH_RECOVERY_CONTROL")
  for (const sql of readFileSync(
    new URL("../src/control.sql", import.meta.url),
    "utf8"
  )
    .split(";")
    .filter((line) => line.trim()))
    await database.prepare(sql).run()
  await database.prepare("CREATE TABLE completed (id INTEGER)").run()
  return { worker, database }
}

test("the real Workerd gate blocks all ordinary requests while paused", async () => {
  const { worker, database } = await setup()
  try {
    const first = await worker.dispatchFetch("https://app.test/")
    expect(first.status, await first.text()).toBe(200)
    await database
      .prepare("UPDATE sylph_recovery_gate SET owner = 'release'")
      .run()
    expect(
      (await worker.dispatchFetch("https://app.test/", { method: "POST" }))
        .status
    ).toBe(503)
    expect((await worker.dispatchFetch("https://app.test/")).status).toBe(503)
    expect(
      (await worker.dispatchFetch("https://app.test/__sylph/release-verify"))
        .status
    ).toBe(401)
    const verified = await worker.dispatchFetch(
      "https://app.test/__sylph/release-verify",
      { headers: { Authorization: "Bearer private-verifier" } }
    )
    expect(await verified.text()).toBe("verified-read-only")
    expect(
      (
        await worker.dispatchFetch("https://app.test/__sylph/release-verify", {
          method: "POST",
          headers: { Authorization: "Bearer private-verifier" },
        })
      ).status
    ).toBe(401)
  } finally {
    await worker.dispose()
  }
})

test("waitUntil application work completes before the writer lease is released", async () => {
  const { worker, database } = await setup()
  try {
    const response = await worker.dispatchFetch("https://app.test/background")
    expect(response.status, await response.text()).toBe(200)
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM completed")
        .first<{ count: number }>()
    ).toEqual({ count: 1 })
    expect(
      await database
        .prepare("SELECT active FROM sylph_recovery_gate")
        .first<{ active: number }>()
    ).toEqual({ active: 0 })
  } finally {
    await worker.dispose()
  }
})

test("the Workerd queue callback retries while paused and drains admitted background work", async () => {
  const { worker, database } = await setup()
  try {
    const entrypoint = await worker.getWorker()
    await database
      .prepare("UPDATE sylph_recovery_gate SET owner = 'release'")
      .run()
    const paused = await entrypoint.queue("jobs", [
      { id: "one", timestamp: new Date(), body: { id: "one" }, attempts: 1 },
    ])
    expect(paused.retryBatch.retry).toBe(true)
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM completed")
        .first<number>("count")
    ).toBe(0)
    await database.prepare("UPDATE sylph_recovery_gate SET owner = NULL").run()
    const resumed = await entrypoint.queue("jobs", [
      { id: "one", timestamp: new Date(), body: { id: "one" }, attempts: 2 },
    ])
    expect(resumed.outcome).toBe("ok")
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM completed")
        .first<number>("count")
    ).toBe(1)
    expect(
      await database
        .prepare("SELECT active FROM sylph_recovery_gate")
        .first<number>("active")
    ).toBe(0)
  } finally {
    await worker.dispose()
  }
})
