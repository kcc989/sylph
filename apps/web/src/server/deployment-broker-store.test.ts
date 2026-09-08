import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import {
  createDeploymentCapability,
  deploymentBrokerStore,
  revokeDeploymentCapability,
  type BrokerDatabase,
} from "./deployment-broker-store"
import type {
  CreatedResourceState,
  ReplacedResourceState,
} from "alchemy/State/ResourceState"
import { capabilityHash } from "./deployment-broker"

const setup = async () => {
  const sql = new Database(":memory:")
  sql.exec(
    await Bun.file(
      new URL(
        "../../../../packages/db/migrations/0004_project_deployment_broker.sql",
        import.meta.url
      )
    ).text()
  )
  sql.exec(
    "CREATE TABLE project_resource_operation (account_id TEXT, project_id TEXT, scope TEXT, run_id TEXT, plan_json TEXT, status TEXT); CREATE TABLE project_resource (account_id TEXT, project_id TEXT, scope TEXT, kind TEXT, name TEXT, resource_id TEXT, state TEXT)"
  )
  sql.exec(
    "INSERT INTO project_resource_operation VALUES ('account','a','production','run-a','[]','deploying'),('account','b','production','run-b','[]','deploying')"
  )
  const prepare = (
    statement: string,
    values: Array<string | number | null> = []
  ) => ({
    bind: (...bound: Array<string | number | null>) =>
      prepare(statement, bound),
    first: async <T>() =>
      sql.query<T, Array<string | number | null>>(statement).get(...values),
    all: async <T>() => ({
      results: sql
        .query<T, Array<string | number | null>>(statement)
        .all(...values),
    }),
    run: async () => {
      sql.query(statement).run(...values)
      return { success: true }
    },
  })
  const database: BrokerDatabase = { prepare }
  return { sql, database, store: deploymentBrokerStore(database) }
}

test("capability storage hashes tokens, copies immutable plan and revokes exact lease", async () => {
  const f = await setup()
  try {
    const issued = await createDeploymentCapability(f.database, "account", {
      projectId: "a",
      scope: "production",
      runId: "run-a",
    })
    expect(
      JSON.stringify(
        f.sql.query("SELECT * FROM project_deployment_capability").all()
      )
    ).not.toContain(issued.token)
    const lease = await f.store.capability(await capabilityHash(issued.token))
    if (!lease) throw new Error("Missing lease")
    expect(lease.projectId).toBe("a")
    f.sql.exec(
      "UPDATE project_resource_operation SET plan_json = '[1]' WHERE project_id = 'a'"
    )
    expect(await f.store.activePlan(lease)).not.toBe(lease.planJson)
    await revokeDeploymentCapability(f.database, issued.id)
    expect(
      (await f.store.capability(await capabilityHash(issued.token)))?.revoked
    ).toBe(true)
    await expect(
      createDeploymentCapability(f.database, "account", {
        projectId: "b",
        scope: "production",
        runId: "run-a",
      })
    ).rejects.toThrow("no active")
  } finally {
    f.sql.close()
  }
})

test("Alchemy state and created IDs remain isolated even when Projects choose identical state keys", async () => {
  const f = await setup()
  try {
    const first = await createDeploymentCapability(f.database, "account", {
      projectId: "a",
      scope: "production",
      runId: "run-a",
    })
    const second = await createDeploymentCapability(f.database, "account", {
      projectId: "b",
      scope: "production",
      runId: "run-b",
    })
    const a = await f.store.capability(await capabilityHash(first.token))
    const b = await f.store.capability(await capabilityHash(second.token))
    if (!a || !b) throw new Error("Missing lease")
    const path = "/state/stacks/sylph-same/stages/production/resources/Database"
    await f.store.state(
      b,
      "PUT",
      path,
      JSON.stringify({ secret: "project-b-secret" })
    )
    expect(await (await f.store.state(a, "GET", path, "")).json()).toBeNull()
    await f.store.state(a, "PUT", path, JSON.stringify({ own: "a" }))
    await f.store.state(a, "DELETE", path, "")
    expect(await (await f.store.state(b, "GET", path, "")).text()).toContain(
      "project-b-secret"
    )
    await f.store.created(b, { kind: "d1", name: "db-b", id: "id-b" })
    expect(await f.store.resources(a)).toEqual([])
    expect(await f.store.resources(b)).toEqual([
      { kind: "d1", name: "db-b", id: "id-b" },
    ])
  } finally {
    f.sql.close()
  }
})

test("installed Alchemy HTTP state client can read and write through capability authorization", async () => {
  const { Effect } = await import("effect")
  const FetchHttpClient = await import("effect/unstable/http/FetchHttpClient")
  const { makeHttpStateStore } = await import("alchemy/State/HttpStateStore")
  const { ProjectDeploymentBroker, ProjectDeploymentBrokerLive } =
    await import("./deployment-broker")
  const f = await setup()
  try {
    const issued = await createDeploymentCapability(f.database, "account", {
      projectId: "a",
      scope: "production",
      runId: "run-a",
    })
    const brokerLayer = ProjectDeploymentBrokerLive({
      store: f.store,
      token: "owner-credential",
    })
    const fetcher = Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        const request = new Request(input, init)
        return Effect.runPromise(
          Effect.gen(function* () {
            const broker = yield* ProjectDeploymentBroker
            return yield* broker.handle(request)
          }).pipe(Effect.provide(brokerLayer))
        )
      },
      { preconnect: fetch.preconnect }
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const state = yield* makeHttpStateStore({
          id: "test",
          url: "https://platform.example/api/project-deployment",
          authToken: issued.token,
        })
        expect(yield* state.getVersion()).toBe(5)
        yield* state.setOutput({
          stack: "sylph-test",
          stage: "production",
          value: { worker: "project-a-web" },
        })
        const prior: CreatedResourceState = {
          status: "created",
          resourceType: "fixture",
          namespace: undefined,
          fqn: "Parent/Child",
          logicalId: "Child",
          instanceId: "old-instance",
          providerVersion: 1,
          downstream: [],
          bindings: [],
          props: {},
          attr: {},
        }
        const value: ReplacedResourceState = {
          ...prior,
          status: "replaced",
          instanceId: "new-instance",
          old: prior,
          deleteFirst: false,
        }
        yield* state.set({
          stack: "sylph-test",
          stage: "production",
          fqn: "Parent/Child",
          value,
        })
        expect(
          yield* state.list({ stack: "sylph-test", stage: "production" })
        ).toEqual(["Parent/Child"])
        expect(
          (yield* state.getReplacedResources({
            stack: "sylph-test",
            stage: "production",
          })).length
        ).toBe(1)
        expect(yield* state.listStacks()).toEqual(["sylph-test"])
        expect(yield* state.listStages("sylph-test")).toEqual(["production"])
        expect(
          yield* state.get({
            stack: "sylph-test",
            stage: "production",
            fqn: "Missing",
          })
        ).toBeUndefined()
        const output = yield* state.getOutput({
          stack: "sylph-test",
          stage: "production",
        })
        yield* state.set({
          stack: "sylph-test",
          stage: "production",
          fqn: "Parent/Sibling",
          value: { ...value, status: "created" },
        })
        yield* state.delete({
          stack: "sylph-test",
          stage: "production",
          fqn: "Parent/Child",
        })
        expect(
          yield* state.list({ stack: "sylph-test", stage: "production" })
        ).toEqual(["Parent/Sibling"])
        expect(
          yield* state.getReplacedResources({
            stack: "sylph-test",
            stage: "production",
          })
        ).toEqual([])
        yield* state.setOutput({
          stack: "sylph-test",
          stage: "preview",
          value: { preserve: true },
        })
        yield* state.setOutput({
          stack: "sylph-test-other",
          stage: "production",
          value: { separate: true },
        })
        yield* state.deleteStack({ stack: "sylph-test", stage: "production" })
        expect(
          yield* state.getOutput({ stack: "sylph-test", stage: "production" })
        ).toBeUndefined()
        expect(
          yield* state.list({ stack: "sylph-test", stage: "production" })
        ).toEqual([])
        expect(
          yield* state.getOutput({ stack: "sylph-test", stage: "preview" })
        ).toEqual({ preserve: true })
        yield* state.deleteStack({ stack: "sylph-test" })
        expect(yield* state.listStacks()).toEqual(["sylph-test-other"])
        expect(
          yield* state.getOutput({
            stack: "sylph-test-other",
            stage: "production",
          })
        ).toEqual({ separate: true })
        return output
      }).pipe(
        Effect.provide(FetchHttpClient.layer),
        Effect.provideService(FetchHttpClient.Fetch, fetcher)
      )
    )
    expect(result).toEqual({ worker: "project-a-web" })
  } finally {
    f.sql.close()
  }
})
