import { expect, test } from "bun:test"
import { waitForDeployedIdentity } from "./identity.mjs"

const record = {
  baseURL: "https://fixture.test",
  commit: "a".repeat(40),
  template: { commit: "b".repeat(40) },
  stage: "smoke-ready",
}
const identity = {
  sourceCommit: record.commit,
  templateCommit: record.template.commit,
  stage: record.stage,
}

test("deployment readiness waits for the provider stub to propagate", async () => {
  let requests = 0
  const pauses: number[] = []
  const result = await waitForDeployedIdentity(
    record,
    async () =>
      ++requests === 1
        ? new Response("Alchemy worker is being deployed...")
        : Response.json(identity),
    async (ms: number) => {
      pauses.push(ms)
    }
  )
  expect(result).toEqual(identity)
  expect(requests).toBe(2)
  expect(pauses).toEqual([5000])
})

test("deployment readiness rejects a different deployed source", async () => {
  await expect(
    waitForDeployedIdentity(record, async () =>
      Response.json({ ...identity, sourceCommit: "c".repeat(40) })
    )
  ).rejects.toThrow("differs from the run record")
})

test("deployment readiness stops when a worker stays unavailable", async () => {
  let requests = 0
  await expect(
    waitForDeployedIdentity(
      record,
      async () => {
        requests++
        return new Response("Unavailable", { status: 503 })
      },
      async () => {}
    )
  ).rejects.toThrow("did not become ready")
  expect(requests).toBe(12)
})
