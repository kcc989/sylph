import { expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import {
  ProjectDeploymentBroker,
  ProjectDeploymentBrokerLive,
  capabilityHash,
  type DeploymentBrokerStore,
} from "./deployment-broker"
import {
  authorizeBrokerRequest,
  validateBrokerBindings,
} from "./deployment-broker-policy"
import {
  BrokerJson,
  type DeploymentCapability,
  type BrokerPlan,
} from "@workspace/domain/project-deployment-broker"

const token = `sylph-cap-${"a".repeat(64)}`
const plan = [
  { kind: "worker" as const, name: "project-a-web" },
  { kind: "d1" as const, name: "project-a-db" },
]
const owned = [
  { kind: "worker", name: "project-a-web", id: "project-a-web" },
  { kind: "d1", name: "project-a-db", id: "database-a" },
]

const fixture = async () => {
  const lease = {
    id: "lease-a",
    projectId: "a",
    accountId: "account",
    scope: "production",
    runId: "run-a",
    planJson: JSON.stringify(plan),
    expiresAt: Date.now() + 60_000,
    revoked: false,
  }
  lease satisfies DeploymentCapability
  let activePlan = lease.planJson
  const calls: Request[] = []
  const hash = await capabilityHash(token)
  const store: DeploymentBrokerStore = {
    capability: async (value) => (value === hash ? lease : null),
    activePlan: async () => activePlan,
    resources: async () => owned,
    created: async () => {},
    state: async () => Response.json([]),
  }
  const layer = ProjectDeploymentBrokerLive({
    store,
    token: "owner-secret-never-in-ci",
    fetch: async (url, options) => {
      calls.push(new Request(url, options))
      return Response.json({
        success: true,
        result: [
          { uuid: "database-a", name: "project-a-db" },
          { uuid: "database-b", name: "project-b-db" },
        ],
      })
    },
  })
  const run = (
    path: string,
    method = "GET",
    body?: typeof BrokerJson.Type,
    bearer = token
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const broker = yield* ProjectDeploymentBroker
        const options: RequestInit = {
          method,
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
          },
        }
        if (method !== "GET" && body) options.body = JSON.stringify(body)
        return yield* broker.handle(
          new Request(
            `https://platform.example/api/project-deployment${path}`,
            options
          )
        )
      }).pipe(Effect.provide(layer))
    )
  return {
    run,
    calls,
    lease,
    changePlan: () => {
      activePlan = JSON.stringify([
        ...plan,
        { kind: "d1", name: "project-b-db" },
      ])
    },
  }
}

test("Project A cannot read, mutate, bind, or create Project B resources", async () => {
  const f = await fixture()
  for (const [path, method, body] of [
    ["/accounts/account/d1/database/database-b", "GET", undefined],
    [
      "/accounts/account/d1/database/database-b/query",
      "POST",
      { sql: "SELECT * FROM secrets" },
    ],
    ["/accounts/account/d1/database", "POST", { name: "project-b-db" }],
    ["/accounts/account/workers/scripts/project-b-web", "GET", undefined],
    [
      "/accounts/account/workers/scripts/project-b-web",
      "PUT",
      { bindings: [] },
    ],
    [
      "/accounts/account/workers/scripts/project-a-web",
      "PUT",
      { bindings: [{ type: "d1", name: "DB", id: "database-b" }] },
    ],
    [
      "/accounts/account/workers/scripts/project-a-web",
      "PUT",
      {
        bindings: [{ type: "service", name: "API", service: "project-b-web" }],
      },
    ],
  ] satisfies Array<[string, string, typeof BrokerJson.Type | undefined]>)
    await expect(f.run(path, method, body)).rejects.toThrow("capability denied")
  expect(f.calls).toHaveLength(0)
})

test("account lists, credential minting, global APIs, unsupported bindings and path tricks cannot escape the capability", async () => {
  const f = await fixture()
  for (const path of [
    "/accounts/other/d1/database",
    "/accounts/account/tokens",
    "/user/tokens",
    "/accounts/account/workers/dispatch/namespaces",
    "/accounts/account/access/apps",
    "/accounts/account/d1/database/database-b/query",
  ])
    await expect(f.run(path, "POST", {})).rejects.toThrow("capability denied")
  for (const type of [
    "dispatch_namespace",
    "hyperdrive",
    "mtls_certificate",
    "secrets_store_secret",
    "unsafe",
  ])
    expect(() =>
      validateBrokerBindings([{ name: "FOREIGN", type }], plan, owned)
    ).toThrow("unsupported binding")
  expect(() =>
    authorizeBrokerRequest(
      "/d1/database/database-a%2fquery",
      "GET",
      {},
      plan,
      owned
    )
  ).toThrow("ambiguous")
  expect(f.calls).toHaveLength(0)
})

test("provider listings omit every other Project and account bearer is server-only", async () => {
  const f = await fixture()
  const response = await f.run("/accounts/account/d1/database")
  const output = await response.text()
  expect(output).toContain("database-a")
  expect(output).not.toContain("database-b")
  expect(output).not.toContain("owner-secret")
  expect(f.calls[0]?.headers.get("Authorization")).toBe(
    "Bearer owner-secret-never-in-ci"
  )
  expect(token).not.toContain("owner-secret")
})

test("plan edits, expiry, revocation and forged capabilities fail before provider access", async () => {
  const f = await fixture()
  await expect(
    f.run(
      "/accounts/account/d1/database",
      "GET",
      undefined,
      `sylph-cap-${"b".repeat(64)}`
    )
  ).rejects.toThrow("capability denied")
  f.lease.revoked = true
  await expect(f.run("/accounts/account/d1/database")).rejects.toThrow(
    "capability denied"
  )
  f.lease.revoked = false
  f.lease.expiresAt = 1
  await expect(f.run("/accounts/account/d1/database")).rejects.toThrow(
    "capability denied"
  )
  f.lease.expiresAt = Date.now() + 60_000
  f.changePlan()
  await expect(f.run("/accounts/account/d1/database")).rejects.toThrow(
    "capability denied"
  )
  expect(f.calls).toHaveLength(0)
})

test("same-Project D1 recovery calls are allowed without allowing foreign restore targets", () => {
  expect(
    authorizeBrokerRequest(
      "/d1/database/database-a/time_travel/bookmark",
      "GET",
      {},
      plan,
      owned
    ).kind
  ).toBe("d1")
  expect(
    authorizeBrokerRequest(
      "/d1/database/database-a/time_travel/restore",
      "POST",
      { bookmark: "known-bookmark" },
      plan,
      owned
    ).kind
  ).toBe("d1")
  expect(() =>
    authorizeBrokerRequest(
      "/d1/database/database-b/time_travel/restore",
      "POST",
      { bookmark: "known-bookmark" },
      plan,
      owned
    )
  ).toThrow("another Project")
  expect(() =>
    authorizeBrokerRequest(
      "/d1/database/database-a/query",
      "POST",
      { sql: "SELECT 1", account_id: "foreign" },
      plan,
      owned
    )
  ).toThrow("unsupported request fields")
})

test("multiple Workers can bind owned service, hosted DO, Workflow and reviewed AI", () => {
  const topology = [
    ...plan,
    {
      kind: "worker" as const,
      name: "project-a-runtime",
      bindings: [{ type: "ai" as const, name: "AI" }],
    },
    {
      kind: "durable_object" as const,
      name: "project-a-runtime/Room",
      worker: "project-a-runtime",
      className: "Room",
    },
    {
      kind: "workflow" as const,
      name: "project-a-job",
      worker: "project-a-runtime",
      className: "Job",
    },
  ]
  expect(() =>
    validateBrokerBindings(
      [
        { name: "API", type: "service", service: "project-a-runtime" },
        {
          name: "ROOM",
          type: "durable_object_namespace",
          script_name: "project-a-runtime",
          class_name: "Room",
        },
        {
          name: "JOB",
          type: "workflow",
          workflow_name: "project-a-job",
          script_name: "project-a-runtime",
          class_name: "Job",
        },
        { name: "AI", type: "ai" },
      ],
      topology,
      owned
    )
  ).not.toThrow()
  expect(() =>
    validateBrokerBindings(
      [
        {
          name: "ROOM",
          type: "durable_object_namespace",
          script_name: "project-b-runtime",
          class_name: "Room",
        },
      ],
      topology,
      owned
    )
  ).toThrow("foreign Durable")
})

test("Project command environment rejects owner credentials and retains only broker capability", async () => {
  const { commandEnvironment } = await import("./command-execution")
  const rejected = commandEnvironment(
    {
      CLOUDFLARE_API_TOKEN: "owner-token",
      CF_TOKEN: "owner-token",
      RESOURCE_TOKEN: "resource-owner-token",
      CLOUDFLARE_API_KEY: "owner-key",
    },
    true
  )
  expect(JSON.stringify(rejected)).not.toContain("owner")
  expect(rejected).not.toHaveProperty("CLOUDFLARE_API_TOKEN")
  const allowed = commandEnvironment(
    {
      CLOUDFLARE_API_TOKEN: token,
      SYLPH_CLOUDFLARE_API_BASE_URL:
        "https://platform.example/api/project-deployment",
    },
    true
  )
  expect(allowed.CLOUDFLARE_API_TOKEN).toBe(token)
  expect(allowed.SYLPH_CLOUDFLARE_API_BASE_URL).toBe(
    "https://platform.example/api/project-deployment"
  )
})

test("R2 object operations preserve literal slash keys and cannot cross buckets or issue bucket removal", () => {
  const topology = [...plan, { kind: "r2" as const, name: "bucket-a" }]
  const resources = [...owned, { kind: "r2", name: "bucket-a", id: "bucket-a" }]
  for (const method of ["GET", "PUT", "DELETE"]) {
    expect(
      authorizeBrokerRequest(
        "/r2/buckets/bucket-a/objects/folder/key.json",
        method,
        {},
        topology,
        resources
      ).objectData
    ).toBe(true)
    expect(() =>
      authorizeBrokerRequest(
        "/r2/buckets/bucket-b/objects/folder/key.json",
        method,
        {},
        topology,
        resources
      )
    ).toThrow("another Project")
  }
  expect(() =>
    authorizeBrokerRequest(
      "/r2/buckets/bucket-a",
      "DELETE",
      {},
      topology,
      resources
    )
  ).toThrow("removal")
  expect(() =>
    authorizeBrokerRequest(
      "/r2/buckets/bucket-a/objects/../bucket-b",
      "PUT",
      {},
      topology,
      resources
    )
  ).toThrow("ambiguous")
  expect(() =>
    authorizeBrokerRequest(
      "/r2/buckets/bucket-a/objects/folder%2Fkey",
      "GET",
      {},
      topology,
      resources
    )
  ).toThrow("ambiguous")
})

test("Worker bindings cannot expose independently retained restore drill data", () => {
  const topology = [
    ...plan,
    {
      kind: "d1" as const,
      name: "project-a-recovery-drill",
      purpose: "recovery_control" as const,
    },
  ]
  const resources = [
    ...owned,
    { kind: "d1", name: "project-a-recovery-drill", id: "drill-id" },
  ]
  expect(() =>
    validateBrokerBindings(
      [{ type: "d1", name: "DRILL", id: "drill-id" }],
      topology,
      resources
    )
  ).toThrow("cannot be bound")
  expect(
    authorizeBrokerRequest(
      "/d1/database/drill-id/time_travel/restore",
      "POST",
      { bookmark: "proof" },
      topology,
      resources
    ).kind
  ).toBe("d1")
})

const protocolFixture = async (
  provider: (request: Request) => Promise<Response>,
  resources = owned,
  frozenPlan: typeof BrokerPlan.Type = plan,
  retirementAllowed = async (_namespaceId: string) => false
) => {
  const hash = await capabilityHash(token)
  const created: Array<{ kind: string; name: string; id: string }> = []
  const calls: Request[] = []
  const lease = {
    id: "protocol",
    projectId: "a",
    accountId: "account",
    scope: "production",
    runId: "run-a",
    planJson: JSON.stringify(frozenPlan),
    expiresAt: Date.now() + 60000,
    revoked: false,
  }
  const layer = ProjectDeploymentBrokerLive({
    token: "server-owner-secret",
    store: {
      capability: async (value) => (value === hash ? lease : null),
      activePlan: async () => lease.planJson,
      resources: async () => [...resources, ...created],
      created: async (_, resource) => {
        created.push(resource)
      },
      state: async () => Response.json(null),
      retirementAllowed: async (_, namespaceId) =>
        retirementAllowed(namespaceId),
    },
    fetch: async (url, options) => {
      const request = new Request(url, options)
      calls.push(request)
      return provider(request)
    },
  })
  const run = (path: string, options: RequestInit = {}) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const broker = yield* ProjectDeploymentBroker
        const headers = new Headers(options.headers)
        headers.set("Authorization", `Bearer ${token}`)
        return yield* broker.handle(
          new Request(
            `https://platform.example/api/project-deployment/accounts/account${path}`,
            { ...options, headers }
          )
        )
      }).pipe(Effect.provide(layer))
    )
  return { run, calls, created }
}

test("collection traversal finds owned IDs on later pages without exposing foreign rows or counts", async () => {
  const f = await protocolFixture(async (request) => {
    const page = new URL(request.url).searchParams.get("page")
    return Response.json({
      success: true,
      result:
        page === "1"
          ? [{ uuid: "database-b", name: "project-b-db" }]
          : [{ uuid: "database-a", name: "project-a-db" }],
      result_info: { total_pages: 2, total_count: 999 },
    })
  })
  const response = await f.run("/d1/database?page=900&per_page=1")
  expect(JSON.parse(await response.text())).toEqual({
    success: true,
    result: [{ uuid: "database-a", name: "project-a-db" }],
    result_info: { page: 1, per_page: 1, count: 1, total_count: 1 },
  })
  expect(
    f.calls.map((request) => new URL(request.url).searchParams.get("page"))
  ).toEqual(["1", "2"])
  expect(
    f.calls.every((request) => !new URL(request.url).searchParams.has("cursor"))
  ).toBe(true)
})

test("reserved new Worker can obtain an asset session and upload a module after absence checks", async () => {
  const f = await protocolFixture(async (request) => {
    if (request.method === "GET")
      return Response.json({ success: false }, { status: 404 })
    if (request.url.endsWith("assets-upload-session"))
      return Response.json({
        success: true,
        result: { jwt: "scoped-assets-jwt", buckets: [["asset-hash"]] },
      })
    const form = await request.formData()
    expect(await form.get("index.js")?.toString()).toBe("export default {}")
    return Response.json({ success: true, result: { id: "project-a-web" } })
  }, [])
  const session = await f.run(
    "/workers/scripts/project-a-web/assets-upload-session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        manifest: { "/index.html": { hash: "asset-hash", size: 12 } },
      }),
    }
  )
  expect(await session.text()).toContain("scoped-assets-jwt")
  const form = new FormData()
  form.set(
    "metadata",
    JSON.stringify({
      main_module: "index.js",
      bindings: [],
      assets: { jwt: "scoped-assets-jwt" },
    })
  )
  form.set("index.js", "export default {}")
  expect(
    (
      await f.run("/workers/scripts/project-a-web", {
        method: "PUT",
        body: form,
      })
    ).status
  ).toBe(200)
  expect(
    f.calls.map((request) => [request.method, new URL(request.url).pathname])
  ).toEqual([
    [
      "GET",
      "/client/v4/accounts/account/workers/scripts/project-a-web/settings",
    ],
    [
      "POST",
      "/client/v4/accounts/account/workers/scripts/project-a-web/assets-upload-session",
    ],
    [
      "GET",
      "/client/v4/accounts/account/workers/scripts/project-a-web/settings",
    ],
    ["PUT", "/client/v4/accounts/account/workers/scripts/project-a-web"],
  ])
  expect(f.created).toEqual([
    { kind: "worker", name: "project-a-web", id: "project-a-web" },
  ])
})

test("new Worker name collisions and uncertain probes cannot publish or expose existing code", async () => {
  for (const status of [200, 403, 500]) {
    const f = await protocolFixture(
      async () =>
        Response.json(
          { success: true, result: { secret: "foreign-worker-code" } },
          { status }
        ),
      []
    )
    await expect(f.run("/workers/scripts/project-a-web")).rejects.toThrow(
      "capability denied"
    )
    await expect(
      f.run("/workers/scripts/project-a-web", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bindings: [] }),
      })
    ).rejects.toThrow("capability denied")
    expect(f.calls).toHaveLength(2)
    expect(f.calls[0]?.method).toBe("GET")
    expect(f.created).toEqual([])
  }
})

test("multipart metadata duplicates and foreign nested bindings fail before provider access", async () => {
  const f = await protocolFixture(async () => Response.json({ success: true }))
  for (const duplicate of [false, true]) {
    const form = new FormData()
    form.append(
      "metadata",
      JSON.stringify({
        bindings: duplicate
          ? []
          : [{ type: "d1", name: "DB", id: "database-b" }],
      })
    )
    if (duplicate) form.append("metadata", JSON.stringify({ bindings: [] }))
    form.append("index.js", "export default {}")
    await expect(
      f.run("/workers/scripts/project-a-web", { method: "PUT", body: form })
    ).rejects.toThrow("capability denied")
  }
  expect(f.calls).toEqual([])
})

test("untrusted routing headers never reach Cloudflare and provider failure text is withheld", async () => {
  const f = await protocolFixture(async (request) => {
    expect(request.headers.get("Authorization")).toBe(
      "Bearer server-owner-secret"
    )
    for (const name of [
      "x-auth-key",
      "x-auth-email",
      "x-http-method-override",
      "x-forwarded-host",
      "cookie",
    ])
      expect(request.headers.has(name)).toBe(false)
    expect(request.method).toBe("GET")
    expect(new URL(request.url).origin).toBe("https://api.cloudflare.com")
    return Response.json(
      { error: "server-owner-secret project-b-sensitive-data" },
      { status: 403 }
    )
  })
  const result = await f.run("/d1/database/database-a", {
    headers: {
      "X-Auth-Key": "attacker",
      "X-Auth-Email": "attacker@example.com",
      "X-HTTP-Method-Override": "DELETE",
      "X-Forwarded-Host": "attacker.example",
      Cookie: "session=foreign",
    },
  })
  expect(result.status).toBe(403)
  expect(await result.text()).not.toMatch(
    /server-owner-secret|project-b-sensitive-data/
  )
})

test("query parameters cannot select a foreign resource or alter the approved method", async () => {
  const f = await protocolFixture(async () =>
    Response.json({ success: true, result: {} })
  )
  for (const query of [
    "account_id=foreign",
    "database_id=database-b",
    "method=DELETE",
    "script_name=project-b-web",
    "redirect=https%3A%2F%2Fattacker.example",
  ]) {
    await expect(
      f.run(`/d1/database/database-a/query?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: "SELECT 1" }),
      })
    ).rejects.toThrow("capability denied")
  }
  expect(f.calls).toEqual([])
})

test("R2 JSON object bytes and allowed metadata survive without accepting routing headers", async () => {
  const payload = '{"result":{"private":"owned data"},"success":false}'
  const topology = [...plan, { kind: "r2" as const, name: "bucket-a" }]
  const f = await protocolFixture(
    async (request) => {
      expect(new URL(request.url).pathname).toEndWith(
        "/bucket-a/objects/folder/key.json"
      )
      if (request.method === "PUT") {
        expect(await request.text()).toBe(payload)
        expect(request.headers.get("cf-r2-custom-metadata")).toBe(
          '{"kind":"fixture"}'
        )
        expect(request.headers.get("cf-r2-storage-class")).toBe("Standard")
        expect(request.headers.get("accept-encoding")).toBe("identity")
        expect(request.headers.has("x-http-method-override")).toBe(false)
        return Response.json({ success: true, result: {} })
      }
      return new Response(payload, {
        headers: {
          "Content-Type": "application/json",
          ETag: '"fixture"',
          "CF-R2-Custom-Metadata": '{"kind":"fixture"}',
          "Set-Cookie": "owner=secret",
          "X-Provider-Private": "foreign",
        },
      })
    },
    [...owned, { kind: "r2", name: "bucket-a", id: "bucket-a" }],
    topology
  )
  await f.run("/r2/buckets/bucket-a/objects/folder/key.json", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "CF-R2-Custom-Metadata": '{"kind":"fixture"}',
      "CF-R2-Storage-Class": "Standard",
      "Accept-Encoding": "identity",
      "X-HTTP-Method-Override": "DELETE",
    },
    body: payload,
  })
  const response = await f.run("/r2/buckets/bucket-a/objects/folder/key.json")
  expect(await response.text()).toBe(payload)
  expect(response.headers.get("ETag")).toBe('"fixture"')
  expect(response.headers.get("CF-R2-Custom-Metadata")).toBe(
    '{"kind":"fixture"}'
  )
  expect(response.headers.has("Set-Cookie")).toBe(false)
  expect(response.headers.has("X-Provider-Private")).toBe(false)
})

test("Workflow creation rejects a colliding name and a foreign host before mutation", async () => {
  const topology = [
    ...plan,
    {
      kind: "workflow" as const,
      name: "project-a-job",
      worker: "project-a-web",
      className: "Job",
    },
  ]
  const f = await protocolFixture(
    async () =>
      Response.json({
        success: true,
        result: { script_name: "project-b-web" },
      }),
    owned,
    topology
  )
  for (const host of ["project-a-web", "project-b-web"]) {
    await expect(
      f.run("/workflows/project-a-job", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script_name: host, class_name: "Job" }),
      })
    ).rejects.toThrow("capability denied")
  }
  expect(f.calls).toHaveLength(1)
  expect(f.calls[0]?.method).toBe("GET")
  expect(f.created).toEqual([])
})

test("Queue consumer updates require an owned host and owned dead-letter Queue", async () => {
  const topology = [
    ...plan,
    { kind: "queue" as const, name: "queue-a" },
    { kind: "queue" as const, name: "queue-a-dead" },
  ]
  const resources = [
    ...owned,
    { kind: "queue", name: "queue-a", id: "queue-id-a" },
    { kind: "queue", name: "queue-a-dead", id: "queue-id-dead" },
  ]
  const f = await protocolFixture(
    async () => Response.json({ success: true, result: {} }),
    resources,
    topology
  )
  const path = "/queues/queue-id-a/consumers/consumer-id"
  const update = (script_name: string, dead_letter_queue: string) =>
    f.run(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "worker",
        script_name,
        dead_letter_queue,
        settings: { batch_size: 10 },
      }),
    })
  await expect(update("project-b-web", "queue-id-dead")).rejects.toThrow(
    "capability denied"
  )
  await expect(update("project-a-web", "queue-id-b")).rejects.toThrow(
    "capability denied"
  )
  expect(f.calls).toEqual([])
  expect((await update("project-a-web", "queue-id-dead")).status).toBe(200)
  expect(f.calls).toHaveLength(1)
})

test("duplicate pagination fields and unsupported D1 cursors fail before provider access", async () => {
  const f = await protocolFixture(async () => Response.json({ success: true }))
  for (const query of [
    "page=1&page=2",
    "cursor=foreign",
    "per_page=1&per_page=100",
  ])
    await expect(f.run(`/d1/database?${query}`)).rejects.toThrow(
      "capability denied"
    )
  expect(f.calls).toEqual([])
})

test("R2 bucket cursor traversal filters foreign buckets and refuses repeated cursors", async () => {
  const topology = [...plan, { kind: "r2" as const, name: "bucket-a" }]
  const resources = [...owned, { kind: "r2", name: "bucket-a", id: "bucket-a" }]
  const f = await protocolFixture(
    async (request) => {
      const cursor = new URL(request.url).searchParams.get("cursor")
      return Response.json({
        success: true,
        result: { buckets: [{ name: cursor ? "bucket-a" : "bucket-b" }] },
        result_info: cursor ? {} : { cursor: "next" },
      })
    },
    resources,
    topology
  )
  const response = await f.run("/r2/buckets")
  expect(JSON.parse(await response.text()).result).toEqual({
    buckets: [{ name: "bucket-a" }],
  })
  expect(f.calls).toHaveLength(2)
  const repeated = await protocolFixture(
    async () =>
      Response.json({
        success: true,
        result: { buckets: [{ name: "bucket-b" }] },
        result_info: { cursor: "same" },
      }),
    resources,
    topology
  )
  await expect(repeated.run("/r2/buckets")).rejects.toThrow("capability denied")
  expect(repeated.calls).toHaveLength(2)
})

test("first-release Worker absence requires a real Cloudflare lookup before any 404 receipt", async () => {
  const f = await protocolFixture(async (request) => {
    expect(request.method).toBe("GET")
    expect(new URL(request.url).pathname).toBe(
      "/client/v4/accounts/account/workers/scripts/project-a-web/settings"
    )
    return Response.json({ errors: [{ code: 10007 }] }, { status: 404 })
  }, [])
  for (const tail of ["", "/settings", "/script-settings"]) {
    const response = await f.run(`/workers/scripts/project-a-web${tail}`)
    expect(response.status).toBe(404)
  }
  expect(f.calls).toHaveLength(3)
  expect(f.created).toEqual([])
})

test("reserved R2 drill storage cannot be bound into an application Worker", () => {
  expect(() =>
    validateBrokerBindings(
      [
        {
          type: "r2_bucket",
          name: "DRILL",
          bucket_name: "project-a-recovery-drill",
        },
      ],
      [
        ...plan,
        {
          kind: "r2",
          name: "project-a-recovery-drill",
          purpose: "recovery_control",
        },
      ],
      [
        ...owned,
        {
          kind: "r2",
          name: "project-a-recovery-drill",
          id: "project-a-recovery-drill",
        },
      ]
    )
  ).toThrow("cannot be bound")
})

test("R2 policy evidence routes read only the exact claimed bucket", async () => {
  const topology = [...plan, { kind: "r2" as const, name: "bucket-a" }]
  const resources = [...owned, { kind: "r2", name: "bucket-a", id: "bucket-a" }]
  const f = await protocolFixture(
    async (request) => {
      const path = new URL(request.url).pathname
      const result = path.endsWith("/sippy")
        ? { enabled: false }
        : path.endsWith("/configuration")
          ? { bucketName: "bucket-a", queues: [] }
          : { rules: [] }
      return Response.json({ success: true, result })
    },
    resources,
    topology
  )
  const routes = [
    "/r2/buckets/bucket-a/lifecycle",
    "/r2/buckets/bucket-a/lock",
    "/r2/buckets/bucket-a/sippy",
    "/event_notifications/r2/bucket-a/configuration",
  ]
  for (const path of routes) {
    expect((await f.run(path)).status).toBe(200)
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      await expect(f.run(path, { method })).rejects.toThrow("capability denied")
    for (const query of [
      "bucket_name=bucket-b",
      "account_id=foreign",
      "cursor=foreign",
    ])
      await expect(f.run(`${path}?${query}`)).rejects.toThrow(
        "capability denied"
      )
    await expect(f.run(path.replace("bucket-a", "bucket-b"))).rejects.toThrow(
      "capability denied"
    )
  }
  expect(f.calls).toHaveLength(4)
  expect(
    f.calls.every(
      (request) =>
        request.method === "GET" &&
        request.headers.get("Authorization") === "Bearer server-owner-secret"
    )
  ).toBe(true)
  const reserved = await protocolFixture(
    async () => Response.json({ success: true }),
    owned,
    topology
  )
  for (const path of routes)
    await expect(reserved.run(path)).rejects.toThrow("capability denied")
  expect(reserved.calls).toEqual([])
  for (const path of [
    "/event_notifications/r2/bucket-a/configuration/queues/foreign",
    "/r2/buckets/bucket-a/locks",
    "/r2/buckets/bucket-a/sippy/source",
  ])
    await expect(f.run(path)).rejects.toThrow("capability denied")
  expect(f.calls).toHaveLength(4)
})

test("Sippy policy evidence never exposes provider credential configuration", async () => {
  const topology = [...plan, { kind: "r2" as const, name: "bucket-a" }]
  const resources = [...owned, { kind: "r2", name: "bucket-a", id: "bucket-a" }]
  for (const enabled of [false, true]) {
    const f = await protocolFixture(
      async () =>
        Response.json({
          success: true,
          result: {
            enabled,
            source: {
              accessKeyId: "source-key",
              secretAccessKey: "source-secret",
              bucket: "external-private-bucket",
            },
            destination: {
              accessKeyId: "destination-key",
              secretAccessKey: "destination-secret",
              account: "foreign-account",
            },
          },
          extra: "provider-private",
        }),
      resources,
      topology
    )
    expect(
      JSON.parse(await (await f.run("/r2/buckets/bucket-a/sippy")).text())
    ).toEqual({ success: true, result: { enabled } })
  }
  for (const result of [
    {},
    { enabled: "false" },
    { enabled: null },
    { enabled: 0 },
  ]) {
    const f = await protocolFixture(
      async () => Response.json({ success: true, result }),
      resources,
      topology
    )
    await expect(f.run("/r2/buckets/bucket-a/sippy")).rejects.toThrow(
      "capability denied"
    )
  }
})

test("Sippy policy evidence rejects non-JSON provider bodies instead of forwarding them", async () => {
  const f = await protocolFixture(
    async () =>
      new Response("provider-credential", {
        headers: { "Content-Type": "text/plain" },
      }),
    [...owned, { kind: "r2", name: "bucket-a", id: "bucket-a" }],
    [...plan, { kind: "r2", name: "bucket-a" }]
  )
  await expect(f.run("/r2/buckets/bucket-a/sippy")).rejects.toThrow(
    "capability denied"
  )
})

test("installed Alchemy default Bucket reconciles through the Project broker", async () => {
  const { reconcilePrivateBucket } =
    await import("../../../../tools/ci-smoke/private-bucket-driver.fixture.mjs")
  let exists = false
  const f = await protocolFixture(
    async (request) => {
      const path = new URL(request.url).pathname
      if (path.endsWith("/r2/buckets") && request.method === "POST") {
        exists = true
        return Response.json({
          success: true,
          result: { name: "bucket-a", storageClass: "Standard" },
        })
      }
      if (path.endsWith("/bucket-a"))
        return exists
          ? Response.json({
              success: true,
              result: { name: "bucket-a", storageClass: "Standard" },
            })
          : Response.json(
              {
                success: false,
                errors: [{ code: 10006, message: "No such bucket" }],
              },
              { status: 404 }
            )
      if (request.method === "DELETE")
        return Response.json({ success: true, result: {} })
      if (request.method === "PUT") {
        expect(JSON.parse(await request.text())).toEqual(
          path.endsWith("/lifecycle") ? { rules: [] } : { enabled: false }
        )
        return Response.json({
          success: true,
          result: { enabled: false, domain: "private.r2.dev" },
        })
      }
      if (path.endsWith("/domains/custom"))
        return Response.json({ success: true, result: { domains: [] } })
      if (path.endsWith("/lifecycle"))
        return Response.json({
          success: true,
          result: {
            rules: [
              {
                id: "default-abort",
                enabled: true,
                conditions: { prefix: "" },
                abortMultipartUploadsTransition: {
                  condition: { type: "Age", maxAge: 604800 },
                },
              },
            ],
          },
        })
      if (path.endsWith("/cors"))
        return Response.json({
          success: true,
          result: {
            rules: [
              {
                allowed: { methods: ["GET"], origins: ["https://old.example"] },
              },
            ],
          },
        })
      if (path.endsWith("/domains/managed"))
        return Response.json({
          success: true,
          result: { enabled: true, domain: "private.r2.dev" },
        })
      throw new Error(`Unexpected fixture request ${request.method} ${path}`)
    },
    owned,
    [...plan, { kind: "r2", name: "bucket-a" }]
  )
  const result = await reconcilePrivateBucket(f.run, token)
  expect(result.bucketName).toBe("bucket-a")
  expect(result.publicDomain).toBeUndefined()
  expect(
    f.calls.map(
      (request) =>
        `${request.method} ${new URL(request.url).pathname.replace("/client/v4/accounts/account", "")}`
    )
  ).toEqual([
    "GET /r2/buckets/bucket-a",
    "GET /r2/buckets/bucket-a",
    "POST /r2/buckets",
    "GET /r2/buckets/bucket-a/domains/custom",
    "GET /r2/buckets/bucket-a/lifecycle",
    "PUT /r2/buckets/bucket-a/lifecycle",
    "GET /r2/buckets/bucket-a/cors",
    "DELETE /r2/buckets/bucket-a/cors",
    "GET /r2/buckets/bucket-a/domains/managed",
    "PUT /r2/buckets/bucket-a/domains/managed",
  ])
})

test("private Bucket reconciliation cannot enable public access, add policies, or route to another jurisdiction", async () => {
  const topology = [...plan, { kind: "r2" as const, name: "bucket-a" }]
  const resources = [...owned, { kind: "r2", name: "bucket-a", id: "bucket-a" }]
  const f = await protocolFixture(
    async () => Response.json({ success: true, result: {} }),
    resources,
    topology
  )
  for (const [path, method, body] of [
    ["/domains/managed", "PUT", { enabled: true }],
    ["/domains/managed", "PUT", { enabled: false, domain: "foreign.example" }],
    ["/lifecycle", "PUT", { rules: [{ id: "delete", enabled: true }] }],
    ["/lifecycle", "PUT", { rules: [], jurisdiction: "eu" }],
    ["/cors", "PUT", { rules: [] }],
    ["/cors", "DELETE", { rules: [] }],
    ["/domains/custom", "POST", { domain: "foreign.example", enabled: true }],
    ["/domains/custom/foreign.example", "DELETE", {}],
  ] satisfies Array<[string, string, typeof BrokerJson.Type]>)
    await expect(
      f.run(`/r2/buckets/bucket-a${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    ).rejects.toThrow("capability denied")
  for (const jurisdiction of ["eu", "fedramp", "default, eu"])
    await expect(
      f.run("/r2/buckets/bucket-a", {
        headers: { "cf-r2-jurisdiction": jurisdiction },
      })
    ).rejects.toThrow("capability denied")
  for (const tail of ["/cors", "/domains/custom", "/domains/managed"])
    await expect(f.run(`/r2/buckets/bucket-b${tail}`)).rejects.toThrow(
      "capability denied"
    )
  expect(f.calls).toEqual([])
})

test("new Bucket reads and creation require independently verified absence", async () => {
  for (const status of [200, 403, 500]) {
    const f = await protocolFixture(
      async () =>
        Response.json(
          { result: { private: "foreign-bucket-data" } },
          { status }
        ),
      owned,
      [...plan, { kind: "r2", name: "bucket-a" }]
    )
    await expect(f.run("/r2/buckets/bucket-a")).rejects.toThrow(
      "capability denied"
    )
    await expect(
      f.run("/r2/buckets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "bucket-a" }),
      })
    ).rejects.toThrow("capability denied")
    expect(f.calls.every((request) => request.method === "GET")).toBe(true)
    expect(f.created).toEqual([])
  }
})

test("known missing CORS configuration preserves its driver code without provider error text", async () => {
  const f = await protocolFixture(
    async () =>
      Response.json(
        {
          success: false,
          errors: [{ code: 10059, message: "provider-private-credential" }],
        },
        { status: 404 }
      ),
    [...owned, { kind: "r2", name: "bucket-a", id: "bucket-a" }],
    [...plan, { kind: "r2", name: "bucket-a" }]
  )
  const response = await f.run("/r2/buckets/bucket-a/cors")
  const result = await response.text()
  expect(result).toContain("10059")
  expect(result).not.toContain("provider-private-credential")
})

const queueInventory = (id: string, name: string) => ({
  queue_id: id,
  queue_name: name,
  consumers: [],
  producers: [],
  consumers_total_count: 0,
  producers_total_count: 0,
})
const queuePlan = [...plan, { kind: "queue" as const, name: "queue-a" }]
const queueResources = [
  ...owned,
  { kind: "queue", name: "queue-a", id: "queue-id-a" },
]

test("Queue collection traverses the full account and reports one complete scoped page", async () => {
  const ownQueue = {
    ...queueInventory("queue-id-a", "queue-a"),
    consumers_total_count: 1,
    producers_total_count: 1,
    consumers: [
      {
        type: "worker",
        consumer_id: "consumer-a",
        script: "project-a-web",
        provider_private: "not-exposed",
      },
    ],
    producers: [
      {
        type: "worker",
        script: "project-a-web",
        provider_private: "not-exposed",
      },
    ],
    unrelated_provider_field: "not-exposed",
  }
  const f = await protocolFixture(
    async (request) =>
      Response.json({
        success: true,
        result:
          new URL(request.url).searchParams.get("page") === "1"
            ? [queueInventory("queue-b", "foreign-queue")]
            : [ownQueue],
        result_info: { total_pages: 2, total_count: 500 },
      }),
    queueResources,
    queuePlan
  )
  const result = await (await f.run("/queues?page=9&per_page=1")).json()
  expect(result).toEqual({
    success: true,
    result: [
      {
        ...queueInventory("queue-id-a", "queue-a"),
        consumers_total_count: 1,
        producers_total_count: 1,
        consumers: [
          {
            type: "worker",
            consumer_id: "consumer-a",
            script: "project-a-web",
          },
        ],
        producers: [{ type: "worker", script: "project-a-web" }],
      },
    ],
    result_info: {
      page: 1,
      per_page: 1,
      count: 1,
      total_pages: 1,
      total_count: 1,
    },
  })
  expect(f.calls.map((request) => new URL(request.url).search)).toEqual([
    "?page=1&per_page=100",
    "?page=2&per_page=100",
  ])
})

test("an undeclared Queue attached to an approved Worker fails without leaking foreign metadata", async () => {
  const f = await protocolFixture(
    async (request) =>
      Response.json({
        success: true,
        result:
          new URL(request.url).searchParams.get("page") === "1"
            ? [queueInventory("queue-id-a", "queue-a")]
            : [
                {
                  ...queueInventory("foreign-id", "private-foreign-queue"),
                  consumers_total_count: 1,
                  consumers: [{ type: "worker", script: "project-a-web" }],
                },
              ],
        result_info: { total_pages: 2 },
      }),
    queueResources,
    queuePlan
  )
  await expect(f.run("/queues?page=1&per_page=100")).rejects.toThrow(
    "capability denied"
  )
  try {
    await f.run("/queues")
  } catch (cause) {
    expect(String(cause)).not.toContain("private-foreign-queue")
    expect(String(cause)).not.toContain("foreign-id")
  }
  expect(f.calls).toHaveLength(4)
})

test("Queue collection fails closed on external actors and incomplete inventories", async () => {
  for (const value of [
    { ...queueInventory("queue-id-a", "queue-a"), consumers_total_count: 1 },
    { ...queueInventory("queue-id-a", "queue-a"), producers_total_count: 1 },
    {
      ...queueInventory("queue-id-a", "queue-a"),
      consumers_total_count: 1,
      consumers: [{ type: "worker", script_name: "foreign-web" }],
    },
    {
      ...queueInventory("queue-id-a", "queue-a"),
      producers_total_count: 1,
      producers: [{ type: "worker", script: "foreign-web" }],
    },
    {
      ...queueInventory("queue-id-a", "queue-a"),
      producers_total_count: 1,
      producers: [{ type: "r2_bucket", bucket_name: "foreign-bucket" }],
    },
    {
      ...queueInventory("foreign-id", "foreign-queue"),
      consumers_total_count: 1,
    },
    { ...queueInventory("queue-id-a", "renamed-queue") },
    {
      ...queueInventory("foreign-id", "foreign-queue"),
      consumers_total_count: 1,
      consumers: [
        { type: "worker", script: "foreign-web", script_name: "project-a-web" },
      ],
    },
  ]) {
    const f = await protocolFixture(
      async () =>
        Response.json({
          success: true,
          result: [value],
          result_info: { total_pages: 1 },
        }),
      queueResources,
      queuePlan
    )
    await expect(f.run("/queues")).rejects.toThrow("capability denied")
  }
})

test("new planned Queue remains absent until creation records its provider identity", async () => {
  let created = false
  const f = await protocolFixture(
    async (request) => {
      if (request.method === "POST") {
        created = true
        return Response.json({
          success: true,
          result: { queue_id: "queue-id-a", queue_name: "queue-a" },
        })
      }
      return Response.json({
        success: true,
        result: created ? [queueInventory("queue-id-a", "queue-a")] : [],
        result_info: { total_pages: 1 },
      })
    },
    owned,
    queuePlan
  )
  expect(
    Schema.decodeUnknownSync(BrokerJson)(await (await f.run("/queues")).json())
      .result
  ).toEqual([])
  await f.run("/queues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queue_name: "queue-a" }),
  })
  expect(
    Schema.decodeUnknownSync(BrokerJson)(await (await f.run("/queues")).json())
      .result
  ).toEqual([queueInventory("queue-id-a", "queue-a")])
  expect(f.created).toEqual([
    { kind: "queue", name: "queue-a", id: "queue-id-a" },
  ])
})

test("Queue replay sends standard messages only to the exact owned planned Queue", async () => {
  const f = await protocolFixture(
    async () => Response.json({ success: true, result: {} }),
    queueResources,
    queuePlan
  )
  const body = {
    body: { version: 1, queue: "queue-a", id: "journal-entry" },
    content_type: "json",
  }
  const send = (path: string, value: typeof BrokerJson.Type) =>
    f.run(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    })
  expect((await send("/queues/queue-id-a/messages", body)).status).toBe(200)
  const sent = f.calls[0]
  if (!sent) throw new Error("Queue request missing")
  expect(Schema.decodeUnknownSync(BrokerJson)(await sent.json())).toEqual(body)
  expect(f.calls[0]?.headers.get("Authorization")).toBe(
    "Bearer server-owner-secret"
  )
  for (const [path, value] of [
    ["/queues/foreign-id/messages", body],
    ["/queues/queue-a/messages", body],
    ["/queues/queue-id-a/messages/batch", { messages: [body] }],
    ["/queues/queue-id-a/messages", { ...body, queue_id: "foreign-id" }],
    [
      "/queues/queue-id-a/messages",
      { ...body, url: "https://foreign.example" },
    ],
    ["/queues/queue-id-a/messages", { ...body, delay_seconds: 1 }],
    ["/queues/queue-id-a/messages", { body: {}, content_type: "text" }],
    [
      "/queues/queue-id-a/messages",
      { body: "x".repeat(128 * 1024 + 1), content_type: "text" },
    ],
    ["/queues/queue-id-a/messages", { content_type: "json" }],
    ["/queues/queue-id-a/messages", { ...body, content_type: "v8" }],
  ] satisfies Array<[string, typeof BrokerJson.Type]>)
    await expect(send(path, value)).rejects.toThrow("capability denied")
  expect(f.calls).toHaveLength(1)
  const notOwned = await protocolFixture(
    async () => Response.json({ success: true }),
    owned,
    queuePlan
  )
  await expect(
    notOwned.run("/queues/queue-id-a/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  ).rejects.toThrow("capability denied")
  expect(notOwned.calls).toHaveLength(0)
})

test("source-owned Queue consumer removal verifies host and provider absence", async () => {
  const f = await protocolFixture(
    async (request) => {
      if (request.method === "DELETE")
        return Response.json({ success: true, result: null })
      if (new URL(request.url).pathname.endsWith("/consumer-a"))
        return Response.json({
          success: true,
          result: {
            consumer_id: "consumer-a",
            type: "worker",
            script: "project-a-web",
          },
        })
      return Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      })
    },
    queueResources,
    queuePlan
  )
  expect(
    (
      await f.run("/queues/queue-id-a/consumers/consumer-a", {
        method: "DELETE",
      })
    ).status
  ).toBe(200)
  expect(f.calls.map((request) => request.method)).toEqual([
    "GET",
    "DELETE",
    "GET",
  ])
  for (const script of ["foreign-web", undefined]) {
    const denied = await protocolFixture(
      async () =>
        Response.json({
          success: true,
          result: { consumer_id: "consumer-a", type: "worker", script },
        }),
      queueResources,
      queuePlan
    )
    await expect(
      denied.run("/queues/queue-id-a/consumers/consumer-a", {
        method: "DELETE",
      })
    ).rejects.toThrow("capability denied")
    expect(denied.calls.map((request) => request.method)).toEqual(["GET"])
  }
  const stale = await protocolFixture(
    async (request) =>
      request.method === "DELETE"
        ? Response.json({ success: true, result: null })
        : Response.json({
            success: true,
            result: new URL(request.url).pathname.endsWith("/consumer-a")
              ? {
                  consumer_id: "consumer-a",
                  type: "worker",
                  script: "project-a-web",
                }
              : [{ consumer_id: "consumer-a" }],
          }),
    queueResources,
    queuePlan
  )
  await expect(
    stale.run("/queues/queue-id-a/consumers/consumer-a", { method: "DELETE" })
  ).rejects.toThrow("capability denied")
})

test("class retirement requires exact owned prior namespace, no snapshots and real provider identity", async () => {
  const descriptor = {
    kind: "durable_object" as const,
    name: "project-a-web/Counter",
    worker: "project-a-web",
    className: "Counter",
    retirement: { resourceId: "namespace-a", generation: null },
  }
  const topology = [...plan, descriptor]
  const resources = [
    ...owned,
    { kind: "durable_object", name: descriptor.name, id: "namespace-a" },
  ]
  const command = (field = "deleted_classes") => ({
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      main_module: "index.js",
      bindings: [],
      migrations: {
        new_tag: "retire-counter",
        steps: [{ [field]: ["Counter"] }],
      },
    }),
  })
  for (const [allowed, providerId, succeeds] of [
    [true, "namespace-a", true],
    [false, "namespace-a", false],
    [true, "namespace-b", false],
  ] as const) {
    const f = await protocolFixture(
      async (request) =>
        new URL(request.url).pathname.endsWith("/containers/applications")
          ? Response.json([])
          : new URL(request.url).pathname.endsWith("/workers/scripts")
            ? Response.json({
                success: true,
                result: [{ id: "project-a-web", created_on: "2026-09-07" }],
              })
            : request.method === "GET"
              ? Response.json({
                  success: true,
                  result: [
                    {
                      id: providerId,
                      script: "project-a-web",
                      class: "Counter",
                    },
                  ],
                  result_info: { total_pages: 1 },
                })
              : Response.json({
                  success: true,
                  result: { id: "project-a-web" },
                }),
      resources,
      topology,
      async () => allowed
    )
    if (succeeds)
      expect(
        (await f.run("/workers/scripts/project-a-web", command())).status
      ).toBe(200)
    else {
      await expect(
        f.run("/workers/scripts/project-a-web", command())
      ).rejects.toThrow("capability denied")
      expect(f.calls.some((request) => request.method === "PUT")).toBe(false)
    }
    await expect(
      f.run("/workers/scripts/project-a-web", command("new_classes"))
    ).rejects.toThrow("capability denied")
  }
  const newClass = await protocolFixture(
    async () => Response.json({ success: true }),
    owned,
    topology,
    async () => true
  )
  await expect(
    newClass.run("/workers/scripts/project-a-web", command())
  ).rejects.toThrow("capability denied")
  expect(newClass.calls).toHaveLength(0)
})

test("object ID inventory is read-only and limited to an owned namespace", async () => {
  const topology = [
    ...plan,
    {
      kind: "durable_object" as const,
      name: "project-a-web/Counter",
      worker: "project-a-web",
      className: "Counter",
    },
  ]
  const resources = [
    ...owned,
    {
      kind: "durable_object",
      name: "project-a-web/Counter",
      id: "namespace-a",
    },
  ]
  const f = await protocolFixture(
    async () =>
      Response.json({
        success: true,
        result: [{ id: "object-a", hasStoredData: true }],
        result_info: { cursor: "next" },
      }),
    resources,
    topology
  )
  expect(
    (
      await f.run(
        "/workers/durable_objects/namespaces/namespace-a/objects?limit=100&cursor=previous"
      )
    ).status
  ).toBe(200)
  await expect(
    f.run("/workers/durable_objects/namespaces/foreign/objects?limit=100")
  ).rejects.toThrow("capability denied")
  await expect(
    f.run("/workers/durable_objects/namespaces/namespace-a/objects", {
      method: "DELETE",
    })
  ).rejects.toThrow("capability denied")
  await expect(
    f.run(
      "/workers/durable_objects/namespaces/namespace-a/objects?sql=SELECT+1"
    )
  ).rejects.toThrow("capability denied")
  expect(f.calls).toHaveLength(1)
})

test("namespace discovery records only the frozen class on its owned Worker before object enumeration", async () => {
  const topology = [
    ...plan,
    {
      kind: "durable_object" as const,
      name: "project-a-web/Counter",
      worker: "project-a-web",
      className: "Counter",
    },
  ]
  const provider = async (request: Request) =>
    Response.json({
      success: true,
      result: new URL(request.url).pathname.endsWith("/objects")
        ? []
        : [
            { id: "namespace-a", script: "project-a-web", class: "Counter" },
            { id: "foreign", script: "project-b-web", class: "Counter" },
            { id: "unplanned", script: "project-a-web", class: "Other" },
          ],
      result_info: { total_pages: 1 },
    })
  const f = await protocolFixture(provider, owned, topology)
  await expect(
    f.run("/workers/durable_objects/namespaces/namespace-a/objects?limit=1000")
  ).rejects.toThrow("capability denied")
  const discovery = await f.run("/workers/durable_objects/namespaces")
  expect(await discovery.text()).not.toContain("foreign")
  expect(f.created).toEqual([
    {
      kind: "durable_object",
      name: "project-a-web/Counter",
      id: "namespace-a",
    },
  ])
  expect(
    (
      await f.run(
        "/workers/durable_objects/namespaces/namespace-a/objects?limit=1000"
      )
    ).status
  ).toBe(200)
  const replacement = await protocolFixture(
    provider,
    [
      ...owned,
      { kind: "durable_object", name: "project-a-web/Counter", id: "previous" },
    ],
    topology
  )
  await expect(
    replacement.run("/workers/durable_objects/namespaces")
  ).rejects.toThrow("capability denied")
  expect(replacement.created).toEqual([])
  const foreignHost = await protocolFixture(
    provider,
    owned.filter((item) => item.kind !== "worker"),
    topology
  )
  await foreignHost.run("/workers/durable_objects/namespaces")
  expect(foreignHost.created).toEqual([])
})

test("an account with no Queues returns a complete empty scoped inventory", async () => {
  const f = await protocolFixture(async () =>
    Response.json({
      success: true,
      result: [],
      result_info: { page: 1, total_pages: 0, total_count: 0 },
    })
  )
  const response = await f.run("/queues?page=1&per_page=100")
  expect(Schema.decodeUnknownSync(BrokerJson)(await response.json())).toEqual({
    success: true,
    result: [],
    result_info: {
      page: 1,
      per_page: 0,
      count: 0,
      total_count: 0,
      total_pages: 1,
    },
  })
  expect(f.calls).toHaveLength(1)
})
