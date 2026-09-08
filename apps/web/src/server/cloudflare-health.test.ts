import { expect, test } from "bun:test"
import { collectHealth, readDeploymentIdentity } from "./cloudflare-health"

const credentials = { accountId: "account", token: "test-token" }
const identity = {
  accountId: "account",
  scriptName: "production",
  deploymentId: "cf-deploy",
  versionId: "version",
}
const target = {
  id: "deploy",
  commit: "a".repeat(40),
  identity_json: JSON.stringify([identity]),
}
const now = 2_000_000
const timestamp = 1_500_000
const event = (requestId: string, outcome = "ok", wallTimeMs = 50) => ({
  timestamp,
  $metadata: {
    id: requestId,
    type: "cf-worker-event",
    statusCode: outcome === "ok" ? 200 : 500,
  },
  $workers: {
    requestId,
    scriptName: "production",
    scriptVersion: { id: "version" },
    outcome,
    wallTimeMs,
  },
  source: {
    authorization: "private-secret",
    message: "private application payload",
  },
})
const mockApi = (events: unknown[], changeAfter = false) => {
  const calls: Array<{ url: string; body: unknown }> = []
  let identities = 0
  const request: typeof fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      })
      if (url.endsWith("/deployments")) {
        identities += 1
        return Response.json({
          success: true,
          result: {
            deployments: [
              {
                id: changeAfter && identities > 1 ? "changed" : "cf-deploy",
                created_on: "2026-01-01T00:00:00Z",
                versions: [{ version_id: "version", percentage: 100 }],
              },
            ],
          },
        })
      }
      return Response.json({
        success: true,
        result: { run: { status: "COMPLETED" }, events: { events } },
      })
    },
    { preconnect: fetch.preconnect }
  )
  return { request, calls }
}

test("collects exact-version errors and latency without retaining private payloads", async () => {
  const api = mockApi([
    event("one", "exception", 3000),
    event("one"),
    event("two"),
  ])
  const result = await collectHealth(credentials, target, now, api.request)
  expect(result.status).toBe("degraded")
  expect(result.requests).toBe(2)
  expect(result.errors).toBe(1)
  expect(result.p95Ms).toBe(3000)
  expect(JSON.stringify(result)).not.toContain("private")
  expect(api.calls).toHaveLength(3)
  expect(api.calls[1].body).toMatchObject({
    view: "events",
    limit: 100,
    dry: true,
    timeframe: { from: 1_020_000, to: 1_920_000 },
  })
})
test("does not attribute foreign versions, Workers, stale events or log lines", async () => {
  const foreign = event("foreign")
  foreign.$workers.scriptVersion.id = "other-version"
  const other = event("other")
  other.$workers.scriptName = "other-project"
  const stale = event("stale")
  stale.timestamp = 100
  const log = event("log")
  log.$metadata.type = "cf-worker-log"
  const api = mockApi([foreign, other, stale, log])
  const result = await collectHealth(credentials, target, now, api.request)
  expect(result.status).toBe("unknown")
  expect(result.requests).toBe(0)
})
test("deployment changes invalidate the entire sample", async () => {
  const api = mockApi([event("one", "exception")], true)
  const result = await collectHealth(credentials, target, now, api.request)
  expect(result.status).toBe("unknown")
  expect(result.evidence).toEqual([])
})
test("missing identity never invokes Cloudflare", async () => {
  const api = mockApi([])
  expect(
    (
      await collectHealth(
        credentials,
        { ...target, identity_json: null },
        now,
        api.request
      )
    ).status
  ).toBe("unknown")
  expect(api.calls).toHaveLength(0)
})
test("permission failures are actionable and do not leak upstream bodies", async () => {
  const request: typeof fetch = Object.assign(
    async () => new Response("secret upstream body", { status: 403 }),
    { preconnect: fetch.preconnect }
  )
  const result = await collectHealth(credentials, target, now, request)
  expect(result.status).toBe("unknown")
  expect(result.detail).toContain("403")
  expect(result.detail).not.toContain("secret")
})
test("caps samples and labels the collection limit", async () => {
  const api = mockApi(
    Array.from({ length: 120 }, (_, index) => event(String(index)))
  )
  const result = await collectHealth(credentials, target, now, api.request)
  expect(result.requests).toBe(100)
  expect(result.limited).toBe(true)
})
test("rejects split traffic and malformed telemetry", async () => {
  const request: typeof fetch = Object.assign(
    async () =>
      Response.json({
        success: true,
        result: {
          deployments: [
            {
              id: "cf-deploy",
              created_on: "today",
              versions: [{ version_id: "version", percentage: 50 }],
            },
          ],
        },
      }),
    { preconnect: fetch.preconnect }
  )
  await expect(
    readDeploymentIdentity(credentials, "production", request)
  ).rejects.toThrow("all traffic")
  const api = mockApi([{ timestamp: "invalid" }])
  expect(
    (await collectHealth(credentials, target, now, api.request)).status
  ).toBe("unknown")
})

test("aborts oversized responses and treats transport failures as unknown", async () => {
  const oversized: typeof fetch = Object.assign(
    async () => new Response("x".repeat(2_000_001)),
    { preconnect: fetch.preconnect }
  )
  expect(
    (await collectHealth(credentials, target, now, oversized)).detail
  ).toContain("collection limit")
  const offline: typeof fetch = Object.assign(
    async () => {
      throw new Error("private transport detail")
    },
    { preconnect: fetch.preconnect }
  )
  const result = await collectHealth(credentials, target, now, offline)
  expect(result.status).toBe("unknown")
  expect(result.detail).not.toContain("private")
})
