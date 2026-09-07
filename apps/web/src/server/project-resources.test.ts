import {
  projectSecretEnvironment,
  saveProjectSecret,
  saveProjectDomain,
  readProjectDomain,
} from "./project-configuration"
import { emptyPreviewBucket } from "./cloudflare-resources"
import { afterEach, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import type { ProjectResourceKind } from "@workspace/domain/project-resources"
import {
  listCloudflareResources,
  type ResourceRequest,
} from "./cloudflare-resources"
import {
  captureProjectResources,
  finishResourceOperation,
  readProjectResources,
  readResourcePlan,
  removePreviewResources,
  reserveProjectResources,
  resourcePrefix,
  verifyResourceUrl,
  type ResourceDatabase,
} from "./project-resources"

const databases: Database[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

const setup = async (scope = "preview:check:1") => {
  const sqlite = new Database(":memory:")
  databases.push(sqlite)
  sqlite.exec("PRAGMA foreign_keys = ON")
  sqlite.exec(
    await Bun.file(
      new URL(
        "../../../../packages/db/migrations/0001_initial.sql",
        import.meta.url
      )
    ).text()
  )
  sqlite.exec(`
    INSERT INTO user (id, name, email) VALUES ('admin', 'Admin', 'admin@example.com');
    INSERT INTO organization (id, name, slug) VALUES ('org', 'Organization', 'org');
    INSERT INTO project (id, organization_id, owner_user_id, name, slug, artifact_repo_id, artifact_repo, artifact_remote)
    VALUES ('one', 'org', 'admin', 'One', 'one', 'repo-one', 'repo-one', 'https://example.com/one.git'),
           ('two', 'org', 'admin', 'Two', 'two', 'repo-two', 'repo-two', 'https://example.com/two.git');
  `)
  const statements = new WeakMap<object, () => { success: boolean }>()
  const prepare = (sql: string, values: Array<string | null> = []) => {
    const statement = {
      bind: (...bound: Array<string | null>) => prepare(sql, bound),
      all: async <T>() => ({
        results: sqlite.query<T, Array<string | null>>(sql).all(...values),
      }),
      first: async <T>() =>
        sqlite.query<T, Array<string | null>>(sql).get(...values),
      run: async () => {
        sqlite.query(sql).run(...values)
        return { success: true }
      },
    }
    statements.set(statement, () => {
      sqlite.query(sql).run(...values)
      return { success: true }
    })
    return statement
  }
  const database: ResourceDatabase = {
    prepare,
    batch: async (batch) =>
      sqlite.transaction(() =>
        batch.map((statement) => {
          const run = statements.get(statement)
          if (!run) throw new Error("Unknown statement")
          return run()
        })
      )(),
  }
  const credentials = { accountId: "account", token: "test-token" }
  const owner = {
    projectId: "one",
    scope,
    runId: "workflow",
  }
  const prefix = await resourcePrefix(owner.projectId, owner.scope)
  const plan = readResourcePlan(
    `SYLPH_RESOURCE_PLAN=${JSON.stringify([
      { kind: "worker", name: `${prefix}-web` },
      { kind: "d1", name: `${prefix}-db` },
    ])}`,
    prefix
  )
  const live: Array<{ kind: ProjectResourceKind; id: string; name: string }> =
    []
  const deletes: string[] = []
  let failDatabaseDelete = false
  const request: ResourceRequest = async (input, init) => {
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-token"
    )
    const path = new URL(String(input)).pathname
    if (init?.method === "DELETE") {
      if (failDatabaseDelete && path.includes("d1/database"))
        return Response.json({ success: false }, { status: 503 })
      const index = live.findIndex((resource) =>
        path.endsWith(`/${resource.id}`)
      )
      if (index < 0) throw new Error("Unknown deletion")
      deletes.push(path)
      live.splice(index, 1)
      return Response.json({ success: true, result: null })
    }
    if (path.endsWith("/settings"))
      return Response.json({
        success: true,
        result: { bindings: [{ type: "d1", name: "DB", id: "database-id" }] },
      })
    if (path.endsWith("/workers/scripts"))
      return Response.json({
        success: true,
        result: live
          .filter((resource) => resource.kind === "worker")
          .map(({ id }) => ({ id, created_on: "2026-09-07T00:00:00Z" })),
      })
    if (path.endsWith("/d1/database"))
      return Response.json({
        success: true,
        result: live
          .filter((resource) => resource.kind === "d1")
          .map(({ id, name }) => ({ uuid: id, name })),
      })
    if (path.endsWith("/r2/buckets"))
      return Response.json({ success: true, result: { buckets: [] } })
    if (path.endsWith("/storage/kv/namespaces") || path.endsWith("/queues"))
      return Response.json({ success: true, result: [] })
    throw new Error(`Unexpected request ${path}`)
  }
  const deploy = () => {
    for (const resource of plan)
      live.push({
        ...resource,
        id: resource.kind === "worker" ? resource.name : "database-id",
      })
  }
  return {
    sqlite,
    database,
    credentials,
    owner,
    prefix,
    plan,
    live,
    deletes,
    request,
    deploy,
    failDelete: () => {
      failDatabaseDelete = true
    },
    allowDelete: () => {
      failDatabaseDelete = false
    },
  }
}

test("reservations block existing unowned resources and concurrent production runs", async () => {
  const fixture = await setup("production")
  fixture.deploy()
  await expect(
    reserveProjectResources(
      fixture.database,
      fixture.credentials,
      fixture.owner,
      fixture.plan,
      fixture.request
    )
  ).rejects.toThrow("without matching Project ownership")
  expect(await readProjectResources(fixture.database, "one")).toEqual([])
  fixture.live.length = 0
  await reserveProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    fixture.plan,
    fixture.request
  )
  await expect(
    reserveProjectResources(
      fixture.database,
      fixture.credentials,
      { ...fixture.owner, runId: "other-run" },
      fixture.plan,
      fixture.request
    )
  ).rejects.toThrow()
  await expect(
    reserveProjectResources(
      fixture.database,
      fixture.credentials,
      { projectId: "two", scope: "production", runId: "another-run" },
      fixture.plan,
      fixture.request
    )
  ).rejects.toThrow()
  expect(await readProjectResources(fixture.database, "two")).toEqual([])
})

test("cleanup resumes after a D1 failure without deleting the Worker twice", async () => {
  const fixture = await setup()
  await reserveProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    fixture.plan,
    fixture.request
  )
  fixture.deploy()
  await captureProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    true,
    fixture.request
  )
  await expect(
    removePreviewResources(
      fixture.database,
      fixture.credentials,
      fixture.owner,
      fixture.request
    )
  ).rejects.toThrow("must stop")
  await finishResourceOperation(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    "retained"
  )
  fixture.failDelete()
  await expect(
    removePreviewResources(
      fixture.database,
      fixture.credentials,
      fixture.owner,
      fixture.request
    )
  ).rejects.toThrow("503")
  expect(
    fixture.sqlite.query("SELECT status FROM project_resource_operation").get()
  ).toEqual({ status: "cleanup_failed" })
  fixture.allowDelete()
  await removePreviewResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    fixture.request
  )
  await removePreviewResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    fixture.request
  )
  expect(fixture.deletes).toHaveLength(2)
  expect(fixture.live).toEqual([])
  expect(
    (await readProjectResources(fixture.database, "one")).every(
      (resource) => resource.state === "deleted"
    )
  ).toBe(true)
})

test("failed deployment cleanup discovers a partially created database without a URL", async () => {
  const fixture = await setup()
  await reserveProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    fixture.plan,
    fixture.request
  )
  fixture.deploy()
  fixture.live.splice(0, 1)
  await finishResourceOperation(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    "retained"
  )
  await removePreviewResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    fixture.request
  )
  expect(fixture.deletes).toHaveLength(1)
  expect(fixture.deletes[0]).toContain("d1/database/database-id")
})

test("cleanup rejects changed identity, wrong owners and production", async () => {
  const fixture = await setup()
  await reserveProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    fixture.plan,
    fixture.request
  )
  fixture.deploy()
  await captureProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    true,
    fixture.request
  )
  await finishResourceOperation(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    "retained"
  )
  for (const resource of fixture.live)
    if (resource.kind === "d1") resource.id = "replacement"
  await expect(
    removePreviewResources(
      fixture.database,
      fixture.credentials,
      fixture.owner,
      fixture.request
    )
  ).rejects.toThrow("identity changed")
  await expect(
    removePreviewResources(
      fixture.database,
      fixture.credentials,
      { ...fixture.owner, projectId: "two" },
      fixture.request
    )
  ).rejects.toThrow()
  await expect(
    removePreviewResources(
      fixture.database,
      fixture.credentials,
      { ...fixture.owner, scope: "production" },
      fixture.request
    )
  ).rejects.toThrow("production")
  expect(fixture.deletes).toEqual([])
})

test("plans require isolated names and returned URLs must match the reserved Worker", async () => {
  const fixture = await setup()
  expect(() =>
    readResourcePlan(
      'SYLPH_RESOURCE_PLAN=[{"kind":"worker","name":"production"}]',
      fixture.prefix
    )
  ).toThrow("reserved prefix")
  expect(() =>
    readResourcePlan(
      'SYLPH_RESOURCE_PLAN=[{"kind":"durable_object","name":"x"}]',
      fixture.prefix
    )
  ).toThrow()
  expect(() =>
    verifyResourceUrl("https://production.account.workers.dev", fixture.plan)
  ).toThrow()
  verifyResourceUrl(
    `https://${fixture.prefix}-web.account.workers.dev`,
    fixture.plan
  )
  expect(await resourcePrefix("two", fixture.owner.scope)).not.toBe(
    fixture.prefix
  )
})

test("resource listing paginates and never interprets authorization failures as absence", async () => {
  const pages: string[] = []
  const request: ResourceRequest = async (input) => {
    const page = new URL(String(input)).searchParams.get("page") ?? ""
    pages.push(page)
    return Response.json({
      success: true,
      result: [{ uuid: `id-${page}`, name: `db-${page}` }],
      result_info: { total_pages: 2 },
    })
  }
  expect(
    await listCloudflareResources({ accountId: "a", token: "b" }, "d1", request)
  ).toHaveLength(2)
  expect(pages).toEqual(["1", "2"])
  const denied: ResourceRequest = async () =>
    Response.json({ success: false }, { status: 404 })
  await expect(
    listCloudflareResources({ accountId: "a", token: "b" }, "d1", denied)
  ).rejects.toThrow("404")
})

test("production never replaces untracked or missing databases silently", async () => {
  const fixture = await setup("production")
  fixture.sqlite.exec(
    "INSERT INTO deployment (id, project_id, [commit], status, actor_user_id) VALUES ('old', 'one', 'commit', 'succeeded', 'admin')"
  )
  await expect(
    reserveProjectResources(
      fixture.database,
      fixture.credentials,
      fixture.owner,
      fixture.plan,
      fixture.request
    )
  ).rejects.toThrow("without an inventory")
  fixture.sqlite.exec("DELETE FROM deployment")
  await reserveProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    fixture.plan,
    fixture.request
  )
  fixture.deploy()
  await captureProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    true,
    fixture.request
  )
  await finishResourceOperation(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    "complete"
  )
  fixture.live.splice(1, 1)
  await expect(
    reserveProjectResources(
      fixture.database,
      fixture.credentials,
      { ...fixture.owner, runId: "next" },
      fixture.plan,
      fixture.request
    )
  ).rejects.toThrow("is missing")
})

test("application secrets isolate environments, encrypt values and reserve control-plane keys", async () => {
  const fixture = await setup()
  await saveProjectSecret(
    fixture.database,
    "one",
    "production",
    "PAYMENTS_KEY",
    "production-value",
    "encryption-key"
  )
  expect(
    await projectSecretEnvironment(
      fixture.database,
      "one",
      "preview",
      "encryption-key"
    )
  ).toEqual({ SYLPH_PROJECT_SECRETS: "{}" })
  expect(
    await projectSecretEnvironment(
      fixture.database,
      "two",
      "production",
      "encryption-key"
    )
  ).toEqual({ SYLPH_PROJECT_SECRETS: "{}" })
  expect(
    await projectSecretEnvironment(
      fixture.database,
      "one",
      "production",
      "encryption-key"
    )
  ).toEqual({ SYLPH_PROJECT_SECRETS: '{"PAYMENTS_KEY":"production-value"}' })
  expect(
    JSON.stringify(fixture.sqlite.query("SELECT * FROM project_secret").all())
  ).not.toContain("production-value")
  await expect(
    saveProjectSecret(
      fixture.database,
      "one",
      "production",
      "CLOUDFLARE_API_TOKEN",
      "override",
      "encryption-key"
    )
  ).rejects.toThrow("reserved")
  await saveProjectSecret(
    fixture.database,
    "one",
    "production",
    "PAYMENTS_KEY",
    null,
    "encryption-key"
  )
  expect(
    await projectSecretEnvironment(
      fixture.database,
      "one",
      "production",
      "encryption-key"
    )
  ).toEqual({ SYLPH_PROJECT_SECRETS: "{}" })
})

test("custom domains are unique and must be declared only in the production plan", async () => {
  const fixture = await setup()
  await saveProjectDomain(
    fixture.database,
    "one",
    "app.example.com",
    "a".repeat(32)
  )
  expect(await readProjectDomain(fixture.database, "one")).toEqual({
    hostname: "app.example.com",
    zone_id: "a".repeat(32),
  })
  await expect(
    saveProjectDomain(
      fixture.database,
      "two",
      "app.example.com",
      "a".repeat(32)
    )
  ).rejects.toThrow()
  const output = `SYLPH_RESOURCE_PLAN=${JSON.stringify([...fixture.plan, { kind: "domain", name: "app.example.com" }])}`
  expect(() => readResourcePlan(output, fixture.prefix)).toThrow(
    "configured production custom domain"
  )
  expect(
    readResourcePlan(output, fixture.prefix, "app.example.com")
  ).toHaveLength(3)
})

test("bucket cleanup drains objects in batches before the bucket can be removed", async () => {
  const objects = ["first", "second"]
  const removed: string[] = []
  const request: ResourceRequest = async (input, init) => {
    expect(String(input)).toContain("r2/buckets/preview-bucket/objects")
    if (init?.method === "DELETE") {
      const keys: string[] = JSON.parse(String(init.body))
      removed.push(...keys)
      objects.splice(0, keys.length)
      return Response.json({ success: true, result: null })
    }
    return Response.json({
      success: true,
      result: objects.slice(0, 1).map((key) => ({ key })),
    })
  }
  await emptyPreviewBucket(
    { accountId: "a", token: "b" },
    "preview-bucket",
    request
  )
  expect(removed).toEqual(["first", "second"])
})

test("undeclared resources within the reserved namespace are inventoried and cleaned", async () => {
  const fixture = await setup()
  await reserveProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    fixture.plan,
    fixture.request
  )
  fixture.deploy()
  fixture.live.push({
    kind: "d1",
    name: `${fixture.prefix}-extra`,
    id: "extra-db",
  })
  await expect(
    captureProjectResources(
      fixture.database,
      fixture.credentials,
      fixture.owner,
      true,
      fixture.request
    )
  ).rejects.toThrow("undeclared resources")
  expect(await readProjectResources(fixture.database, "one")).toHaveLength(3)
  await finishResourceOperation(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    "retained"
  )
  await removePreviewResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    fixture.request
  )
  expect(fixture.live).toEqual([])
  expect(fixture.deletes).toHaveLength(3)
})

test("cleanup rejects a recreated Worker even when its name is unchanged", async () => {
  const fixture = await setup()
  await reserveProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    fixture.plan,
    fixture.request
  )
  fixture.deploy()
  await captureProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    true,
    fixture.request
  )
  await finishResourceOperation(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    "retained"
  )
  const replaced: ResourceRequest = async (input, init) => {
    if (new URL(String(input)).pathname.endsWith("/workers/scripts"))
      return Response.json({
        success: true,
        result: fixture.live
          .filter((resource) => resource.kind === "worker")
          .map(({ id }) => ({ id, created_on: "2026-09-08T00:00:00Z" })),
      })
    return fixture.request(input, init)
  }
  await expect(
    removePreviewResources(
      fixture.database,
      fixture.credentials,
      fixture.owner,
      replaced
    )
  ).rejects.toThrow("identity changed")
  expect(fixture.deletes).toEqual([])
})
