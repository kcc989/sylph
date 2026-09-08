import { Effect } from "effect"
import {
  ProjectResourceMutations,
  ProjectResourceMutationsLayer,
} from "./resource-mutations"
import { verifyWorkerResources } from "./cloudflare-resources"
import type {
  ResourceMutationInput,
  ResourceMutationReview,
  CloudflareWorkerBindings,
} from "@workspace/domain/project-resources"
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
  sqlite.exec(
    await Bun.file(
      new URL(
        "../../../../packages/db/migrations/0003_resource_lifecycle.sql",
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
  const live: Array<{
    kind: ProjectResourceKind
    id: string
    name: string
    worker?: string
    className?: string
  }> = []
  const bindings = new Map<
    string,
    typeof CloudflareWorkerBindings.Type.bindings
  >()
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
        path.endsWith(
          `/${resource.kind === "workflow" ? resource.name : resource.id}`
        )
      )
      if (index < 0) throw new Error("Unknown deletion")
      deletes.push(path)
      const removed = live.splice(index, 1)[0]
      if (removed?.kind === "worker") {
        for (let child = live.length - 1; child >= 0; child--)
          if (
            live[child]?.kind === "durable_object" &&
            live[child]?.worker === removed.name
          )
            live.splice(child, 1)
      }
      return Response.json({ success: true, result: null })
    }
    if (path.endsWith("/settings"))
      return Response.json({
        success: true,
        result: {
          bindings: bindings.get(path.split("/").at(-2) ?? "") ?? [
            { type: "d1", name: "DB", id: "database-id" },
          ],
        },
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
    if (path.endsWith("/containers/applications")) return Response.json([])
    if (path.endsWith("/workers/durable_objects/namespaces"))
      return Response.json({
        success: true,
        result: live
          .filter((item) => item.kind === "durable_object")
          .map((item) => ({
            id: item.id,
            script: item.worker,
            class: item.className,
          })),
      })
    if (path.endsWith("/workflows"))
      return Response.json({
        success: true,
        result: live
          .filter((item) => item.kind === "workflow")
          .map((item) => ({
            id: item.id,
            name: item.name,
            script_name: item.worker,
            class_name: item.className,
            created_on: "2026-09-07T00:00:00Z",
          })),
      })
    if (path.endsWith("/workers/domains"))
      return Response.json({ success: true, result: [] })
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
    bindings,
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

test("undeclared resources require adoption and cannot gain ownership from a prefix", async () => {
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
  ).rejects.toThrow("requires explicit adoption")
  expect(await readProjectResources(fixture.database, "one")).toHaveLength(2)
  await finishResourceOperation(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    "retained"
  )
  await expect(
    removePreviewResources(
      fixture.database,
      fixture.credentials,
      fixture.owner,
      fixture.request
    )
  ).rejects.toThrow("requires explicit adoption")
  expect(fixture.live).toHaveLength(3)
  expect(fixture.deletes).toHaveLength(0)
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

const mutationService = (fixture: Awaited<ReturnType<typeof setup>>) => {
  const layer = ProjectResourceMutationsLayer(
    fixture.database,
    fixture.credentials,
    fixture.request
  )
  return {
    review: (input: ResourceMutationInput) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* ProjectResourceMutations).review(input)
        }).pipe(Effect.provide(layer))
      ),
    confirm: (
      review: ResourceMutationReview,
      confirmation = `${review.action} production`
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* ProjectResourceMutations).confirm({
            projectId: review.projectId,
            reviewId: review.id,
            confirmation,
          })
        }).pipe(Effect.provide(layer))
      ),
    execute: (review: ResourceMutationReview) =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* (yield* ProjectResourceMutations).execute(
            review.projectId,
            review.id
          )
        }).pipe(Effect.provide(layer))
      ),
  }
}

test("multi-Worker topology verifies real namespace IDs, Workflow identity, service and AI references and cleans host children", async () => {
  const fixture = await setup()
  const web = `${fixture.prefix}-web`
  const host = `${fixture.prefix}-runtime`
  const job = `${fixture.prefix}-job`
  const room = `${host}/Room`
  const plan = readResourcePlan(
    `SYLPH_RESOURCE_PLAN=${JSON.stringify([
      {
        kind: "worker",
        name: web,
        entrypoint: true,
        bindings: [
          { type: "service", name: "API", target: host },
          { type: "durable_object_namespace", name: "ROOM", target: room },
          { type: "workflow", name: "JOB", target: job },
          { type: "ai", name: "AI" },
        ],
      },
      { kind: "worker", name: host },
      { kind: "d1", name: `${fixture.prefix}-db` },
      { kind: "durable_object", name: room, worker: host, className: "Room" },
      { kind: "workflow", name: job, worker: host, className: "Job" },
    ])}`,
    fixture.prefix
  )
  await reserveProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    plan,
    fixture.request
  )
  fixture.deploy()
  fixture.live.push(
    { kind: "worker", name: host, id: host },
    {
      kind: "durable_object",
      name: room,
      worker: host,
      className: "Room",
      id: "namespace-id",
    },
    {
      kind: "workflow",
      name: job,
      worker: host,
      className: "Job",
      id: "workflow-id",
    }
  )
  fixture.bindings.set(web, [
    { type: "service", name: "API", service: host },
    {
      type: "durable_object_namespace",
      name: "ROOM",
      namespace_id: "namespace-id",
      script_name: host,
      class_name: "Room",
    },
    {
      type: "workflow",
      name: "JOB",
      workflow_name: job,
      script_name: host,
      class_name: "Job",
    },
    { type: "ai", name: "AI" },
  ])
  const inventory = await captureProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    true,
    fixture.request
  )
  expect(inventory).toHaveLength(5)
  verifyResourceUrl(`https://${web}.account.workers.dev`, plan)
  expect(() =>
    verifyResourceUrl(`https://${host}.account.workers.dev`, plan)
  ).toThrow()
  fixture.bindings.set(web, [{ type: "ai", name: "UNREVIEWED_AI" }])
  await expect(
    verifyWorkerResources(fixture.credentials, inventory, fixture.request, plan)
  ).rejects.toThrow("unsupported")
  fixture.bindings.set(web, [])
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
  expect(fixture.live).toHaveLength(0)
  expect(fixture.deletes[0]).toContain(`/workflows/${job}`)
  expect(fixture.deletes.some((path) => path.includes("durable_objects"))).toBe(
    false
  )
})

test("adoption requires exact confirmation, rejects source drift and cannot take another Project's resources", async () => {
  const fixture = await setup("production")
  fixture.deploy()
  const service = mutationService(fixture)
  const input: ResourceMutationInput = {
    projectId: "one",
    scope: "production",
    action: "adopt",
    resources: fixture.plan,
  }
  const review = await service.review(input)
  expect(await readProjectResources(fixture.database, "one")).toHaveLength(0)
  await expect(service.execute(review)).rejects.toThrow("confirmation")
  await expect(service.confirm(review, "yes")).rejects.toThrow("exact action")
  const db = fixture.live.find((item) => item.kind === "d1")
  if (!db) throw new Error("Missing fixture database")
  db.id = "replacement"
  await expect(service.confirm(review)).rejects.toThrow(
    "outside the reserved resource plan"
  )
  db.id = "database-id"
  await service.confirm(review)
  await service.execute(review)
  expect(
    (await readProjectResources(fixture.database, "one")).every(
      (item) => item.state === "active"
    )
  ).toBe(true)
  await expect(service.review({ ...input, projectId: "two" })).rejects.toThrow(
    "ownership claim"
  )
  expect(fixture.deletes).toHaveLength(0)
})

test("production retirement keeps data, blocks referenced resources, and removal preserves partial progress", async () => {
  const fixture = await setup("production")
  fixture.deploy()
  const service = mutationService(fixture)
  const adopt = await service.review({
    projectId: "one",
    scope: "production",
    action: "adopt",
    resources: fixture.plan,
  })
  await service.confirm(adopt)
  await service.execute(adopt)
  const databasePlan = fixture.plan.filter((item) => item.kind === "d1")
  await expect(
    service.review({
      projectId: "one",
      scope: "production",
      action: "retire",
      resources: databasePlan,
    })
  ).rejects.toThrow("still referenced")
  const retire = await service.review({
    projectId: "one",
    scope: "production",
    action: "retire",
    resources: fixture.plan,
  })
  await service.confirm(retire)
  await expect(
    reserveProjectResources(
      fixture.database,
      fixture.credentials,
      fixture.owner,
      fixture.plan,
      fixture.request
    )
  ).rejects.toThrow()
  await service.execute(retire)
  expect(fixture.live).toHaveLength(2)
  expect(
    (await readProjectResources(fixture.database, "one")).every(
      (item) => item.state === "retired"
    )
  ).toBe(true)
  const remove = await service.review({
    projectId: "one",
    scope: "production",
    action: "remove",
    resources: fixture.plan,
  })
  await service.confirm(remove)
  fixture.failDelete()
  await expect(service.execute(remove)).rejects.toThrow("503")
  expect(
    (await readProjectResources(fixture.database, "one")).find(
      (item) => item.kind === "worker"
    )?.state
  ).toBe("deleted")
  expect(
    (await readProjectResources(fixture.database, "one")).find(
      (item) => item.kind === "d1"
    )?.state
  ).toBe("retired")
  fixture.allowDelete()
  const retry = await service.review({
    projectId: "one",
    scope: "production",
    action: "remove",
    resources: databasePlan,
  })
  await service.confirm(retry)
  await service.execute(retry)
  expect(fixture.live).toHaveLength(0)
})

test("recovery-control claims cannot be adopted or retired as application data", async () => {
  const fixture = await setup("production")
  fixture.deploy()
  const service = mutationService(fixture)
  await expect(
    service.review({
      projectId: "one",
      scope: "production",
      action: "adopt",
      resources: fixture.plan.map((item) =>
        item.kind === "d1" ? { ...item, purpose: "recovery_control" } : item
      ),
    })
  ).rejects.toThrow("independent ownership")
  fixture.sqlite.exec(
    `INSERT INTO project_resource (account_id, project_id, scope, kind, name, resource_id, purpose, state) VALUES ('account', 'one', 'production', 'd1', '${fixture.prefix}-db', 'database-id', 'recovery_control', 'active')`
  )
  await expect(
    service.review({
      projectId: "one",
      scope: "production",
      action: "retire",
      resources: fixture.plan.filter((item) => item.kind === "d1"),
    })
  ).rejects.toThrow("independent ownership")
  expect(fixture.deletes).toHaveLength(0)
})

test("unknown kinds, missing hosts and cross-Project service targets fail before reservations", async () => {
  const fixture = await setup()
  for (const addition of [
    { kind: "vectorize", name: `${fixture.prefix}-vectors` },
    { kind: "workflow", name: `${fixture.prefix}-job` },
    { kind: "worker", name: `${fixture.prefix}-other` },
  ]) {
    expect(() =>
      readResourcePlan(
        `SYLPH_RESOURCE_PLAN=${JSON.stringify([...fixture.plan, addition])}`,
        fixture.prefix
      )
    ).toThrow()
  }
  expect(() =>
    readResourcePlan(
      `SYLPH_RESOURCE_PLAN=${JSON.stringify([{ kind: "worker", name: `${fixture.prefix}-web`, bindings: [{ type: "service", name: "SHARED", target: "another-project" }] }])}`,
      fixture.prefix
    )
  ).toThrow("cross-Project")
})

test("concurrent and expired adoption reviews cannot bypass the production lock", async () => {
  const fixture = await setup("production")
  fixture.deploy()
  const service = mutationService(fixture)
  const input: ResourceMutationInput = {
    projectId: "one",
    scope: "production",
    action: "adopt",
    resources: fixture.plan,
  }
  const first = await service.review(input)
  const second = await service.review(input)
  await service.confirm(first)
  await expect(service.confirm(second)).rejects.toThrow(
    "current resource operation"
  )
  await service.confirm(first)
  await service.execute(first)
  await service.execute(first)
  expect(await readProjectResources(fixture.database, "one")).toHaveLength(2)
  const retire = await service.review({ ...input, action: "retire" })
  fixture.sqlite
    .query("UPDATE project_resource_review SET review_json = ? WHERE id = ?")
    .run(JSON.stringify({ ...retire, expiresAt: 1 }), retire.id)
  await expect(service.confirm(retire)).rejects.toThrow("current review")
  expect(fixture.deletes).toHaveLength(0)
})

test("a new external binding after confirmation stops removal before any deletion", async () => {
  const fixture = await setup("production")
  fixture.deploy()
  const service = mutationService(fixture)
  const input: ResourceMutationInput = {
    projectId: "one",
    scope: "production",
    action: "adopt",
    resources: fixture.plan,
  }
  const adopt = await service.review(input)
  await service.confirm(adopt)
  await service.execute(adopt)
  const retire = await service.review({ ...input, action: "retire" })
  await service.confirm(retire)
  await service.execute(retire)
  const remove = await service.review({ ...input, action: "remove" })
  await service.confirm(remove)
  fixture.live.push({
    kind: "worker",
    name: "unrelated-worker",
    id: "unrelated-worker",
  })
  await expect(service.execute(remove)).rejects.toThrow("still referenced")
  expect(fixture.deletes).toHaveLength(0)
})

test("Preview cleanup retains independently owned recovery control state", async () => {
  const fixture = await setup()
  const control = {
    kind: "d1",
    name: `${fixture.prefix}-recovery`,
    purpose: "recovery_control",
  } as const
  await reserveProjectResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    [...fixture.plan, control],
    fixture.request
  )
  fixture.deploy()
  fixture.live.push({ kind: "d1", name: control.name, id: "control-id" })
  fixture.bindings.set(`${fixture.prefix}-web`, [
    { type: "d1", name: "DB", id: "database-id" },
    { type: "d1", name: "SYLPH_RECOVERY_CONTROL", id: "control-id" },
  ])
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
  await removePreviewResources(
    fixture.database,
    fixture.credentials,
    fixture.owner,
    fixture.request
  )
  expect(fixture.live).toEqual([
    { kind: "d1", name: control.name, id: "control-id" },
  ])
  expect(
    (await readProjectResources(fixture.database, "one")).find(
      (item) => item.resource_id === "control-id"
    )?.state
  ).toBe("active")
  expect(fixture.deletes.some((path) => path.endsWith("control-id"))).toBe(
    false
  )
})

test("legacy resource names are usable only after explicit production adoption", async () => {
  const fixture = await setup("production")
  const input: ResourceMutationInput = {
    projectId: "one",
    scope: "production",
    action: "adopt",
    resources: [
      { kind: "worker", name: "legacy-web", adopted: true },
      { kind: "d1", name: "legacy-db", adopted: true },
    ],
  }
  fixture.live.push(
    { kind: "worker", id: "legacy-web", name: "legacy-web" },
    { kind: "d1", id: "database-id", name: "legacy-db" }
  )
  const plan = readResourcePlan(
    `SYLPH_RESOURCE_PLAN=${JSON.stringify(input.resources)}`,
    fixture.prefix
  )
  await expect(
    reserveProjectResources(
      fixture.database,
      fixture.credentials,
      fixture.owner,
      plan,
      fixture.request
    )
  ).rejects.toThrow("explicit reviewed production adoption")
  const service = mutationService(fixture)
  const review = await service.review(input)
  await service.confirm(review)
  await service.execute(review)
  await reserveProjectResources(
    fixture.database,
    fixture.credentials,
    { ...fixture.owner, runId: "next-deployment" },
    plan,
    fixture.request
  )
  expect(fixture.deletes).toHaveLength(0)
})

test("container-backed namespaces fail management instead of masquerading as Durable Objects", async () => {
  const fixture = await setup()
  const namespace = {
    account_id: "account",
    project_id: "one",
    scope: fixture.owner.scope,
    kind: "durable_object",
    name: `${fixture.prefix}-runtime/Sandbox`,
    resource_id: "container-namespace",
    generation: null,
    state: "active",
  } as const
  const request: ResourceRequest = async (input, init) => {
    if (String(input).endsWith("/containers/applications"))
      return Response.json([
        {
          id: "container-app",
          durable_objects: { namespace_id: "container-namespace" },
        },
      ])
    return fixture.request(input, init)
  }
  await expect(
    verifyWorkerResources(fixture.credentials, [namespace], request)
  ).rejects.toThrow("Containers are outside supported")
  expect(fixture.deletes).toHaveLength(0)
})

test("an external Queue consumer blocks Worker cleanup before any mutation", async () => {
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
  const request: ResourceRequest = async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith("/queues"))
      return Response.json({
        success: true,
        result: [{ queue_id: "external-queue", queue_name: "external" }],
      })
    if (path.endsWith("/queues/external-queue/consumers"))
      return Response.json({
        success: true,
        result: [
          {
            consumer_id: "consumer",
            type: "worker",
            script: `${fixture.prefix}-web`,
          },
        ],
      })
    return fixture.request(input, init)
  }
  await expect(
    removePreviewResources(
      fixture.database,
      fixture.credentials,
      fixture.owner,
      request
    )
  ).rejects.toThrow("detach it through the owning Alchemy stack")
  expect(fixture.deletes).toHaveLength(0)
})

test("R2 plan bindings require exact application bucket ownership", () => {
  const plan = readResourcePlan(
    `SYLPH_RESOURCE_PLAN=${JSON.stringify([
      {
        kind: "worker",
        name: "owned-app",
        bindings: [
          { type: "r2_bucket", name: "UPLOADS", target: "owned-uploads" },
        ],
      },
      { kind: "r2", name: "owned-uploads" },
    ])}`,
    "owned"
  )
  expect(plan).toHaveLength(2)
  for (const bucket of [
    { kind: "r2", name: "owned-foreign" },
    { kind: "r2", name: "owned-uploads", purpose: "recovery_control" },
  ])
    expect(() =>
      readResourcePlan(
        `SYLPH_RESOURCE_PLAN=${JSON.stringify([plan[0], bucket])}`,
        "owned"
      )
    ).toThrow()
})

test("managed KV and Queue bindings require exact same-Project resource kinds", () => {
  for (const [type, kind] of [
    ["kv_namespace", "kv"],
    ["queue", "queue"],
  ]) {
    const worker = {
      kind: "worker",
      name: "owned-app",
      bindings: [{ type, name: "DATA", target: "owned-data" }],
    }
    const plan = [worker, { kind, name: "owned-data" }]
    expect(
      readResourcePlan(`SYLPH_RESOURCE_PLAN=${JSON.stringify(plan)}`, "owned")
    ).toHaveLength(2)
    for (const other of [
      { kind, name: "owned-other" },
      { kind: "r2", name: "owned-data" },
    ]) {
      expect(() =>
        readResourcePlan(
          `SYLPH_RESOURCE_PLAN=${JSON.stringify([worker, other])}`,
          "owned"
        )
      ).toThrow()
    }
  }
})

test("removal Workspace review binds accepted source, live identity and recovery compatibility", async () => {
  const {
    inspectResourceRemoval,
    requireCurrentRemovalPreparation,
    removalPreparationPrompt,
  } = await import("./resource-removal-preparation")
  const f = await setup("production")
  const worker = f.plan.find((item) => item.kind === "worker")
  if (!worker) throw new Error("Worker fixture missing")
  const object = {
    kind: "durable_object" as const,
    name: `${worker.name}/Counter`,
    worker: worker.name,
    className: "Counter",
  }
  const plan = [...f.plan, object]
  await reserveProjectResources(
    f.database,
    f.credentials,
    f.owner,
    plan,
    f.request
  )
  f.deploy()
  f.live.push({ ...object, id: "namespace-a" })
  await captureProjectResources(
    f.database,
    f.credentials,
    f.owner,
    true,
    f.request
  )
  await finishResourceOperation(f.database, f.credentials, f.owner, "complete")
  const commit = "a".repeat(40)
  f.sqlite
    .query(
      "INSERT INTO deployment (id, project_id, [commit], status, actor_user_id) VALUES ('release-a', 'one', ?, 'succeeded', 'admin')"
    )
    .run(commit)
  const selection = {
    projectId: "one",
    resources: [
      {
        kind: "durable_object" as const,
        name: object.name,
        resourceId: "namespace-a",
        generation: null,
      },
    ],
  }
  const reviewed = await inspectResourceRemoval(
    f.database,
    f.credentials,
    selection,
    commit,
    f.request
  )
  expect(reviewed.baseCommit).toBe(commit)
  expect(reviewed.resources[0]?.retirement).toEqual({
    resourceId: "namespace-a",
    generation: null,
  })
  expect(removalPreparationPrompt(reviewed)).toContain("Second checkpoint")
  await expect(
    inspectResourceRemoval(
      f.database,
      f.credentials,
      selection,
      "b".repeat(40),
      f.request
    )
  ).rejects.toThrow("accepted commit")
  const snapshot = {
    deploymentId: "release-a",
    projectId: "one",
    commit,
    baseCommit: null,
    capturedAt: 1,
    expiresAt: 9999999999999,
    writesPaused: true,
    inventoryComplete: true,
    resources: [
      {
        id: "namespace-a",
        kind: "durable-object",
        backupRef: "actual-fixture-reference",
        restoreVerifiedAt: 1,
      },
    ],
  }
  f.sqlite
    .query("UPDATE deployment SET recovery_json = ? WHERE id = 'release-a'")
    .run(JSON.stringify(snapshot))
  const blocked = await inspectResourceRemoval(
    f.database,
    f.credentials,
    selection,
    commit,
    f.request
  )
  expect(blocked.blockers).toHaveLength(1)
  expect(() => requireCurrentRemovalPreparation(reviewed, blocked)).toThrow(
    "recovery points changed"
  )
  await expect(
    reserveProjectResources(
      f.database,
      f.credentials,
      { ...f.owner, runId: "retire" },
      [
        ...f.plan,
        {
          ...object,
          retirement: { resourceId: "namespace-a", generation: null },
        },
      ],
      f.request
    )
  ).rejects.toThrow("invalidate saved recovery points")
  const live = f.live.find((item) => item.kind === "durable_object")
  if (!live) throw new Error("Namespace fixture missing")
  live.id = "replacement"
  await expect(
    inspectResourceRemoval(
      f.database,
      f.credentials,
      selection,
      commit,
      f.request
    )
  ).rejects.toThrow("Provider resource identity changed")
})

test("a source-retired namespace requires confirmed absence before retirement and removal", async () => {
  const f = await setup("production")
  const worker = f.plan.find((item) => item.kind === "worker")
  if (!worker) throw new Error("Worker fixture missing")
  const object = {
    kind: "durable_object" as const,
    name: `${worker.name}/Counter`,
    worker: worker.name,
    className: "Counter",
  }
  await reserveProjectResources(
    f.database,
    f.credentials,
    f.owner,
    [...f.plan, object],
    f.request
  )
  f.deploy()
  f.live.push({ ...object, id: "namespace-a" })
  await captureProjectResources(
    f.database,
    f.credentials,
    f.owner,
    true,
    f.request
  )
  await finishResourceOperation(f.database, f.credentials, f.owner, "complete")
  const retirement = {
    ...object,
    retirement: { resourceId: "namespace-a", generation: null },
  }
  const next = { ...f.owner, runId: "retirement-release" }
  await reserveProjectResources(
    f.database,
    f.credentials,
    next,
    [...f.plan, retirement],
    f.request
  )
  const namespace = f.live.find((item) => item.kind === "durable_object")
  if (!namespace) throw new Error("Namespace fixture missing")
  namespace.name = `${worker.name}/Renamed`
  namespace.className = "Renamed"
  await expect(
    captureProjectResources(f.database, f.credentials, next, true, f.request)
  ).rejects.toThrow()
  f.live.splice(f.live.indexOf(namespace), 1)
  await captureProjectResources(
    f.database,
    f.credentials,
    next,
    true,
    f.request
  )
  await finishResourceOperation(f.database, f.credentials, next, "complete")
  const service = mutationService(f)
  const review = await service.review({
    projectId: "one",
    scope: "production",
    action: "retire",
    resources: [object],
  })
  await service.confirm(review)
  await service.execute(review)
  expect(
    (await readProjectResources(f.database, "one")).find(
      (item) => item.kind === "durable_object"
    )?.state
  ).toBe("retired")
  const removal = await service.review({
    projectId: "one",
    scope: "production",
    action: "remove",
    resources: [object],
  })
  await service.confirm(removal)
  await service.execute(removal)
  expect(
    (await readProjectResources(f.database, "one")).find(
      (item) => item.kind === "durable_object"
    )?.state
  ).toBe("deleted")
  expect(f.deletes).toEqual([])
})
