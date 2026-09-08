import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { Schema } from "effect"
import {
  LifecycleActionOptions,
  LifecycleProviderEvidence,
} from "@workspace/domain/lifecycle-actions"
import {
  type CombinedSmokeRun,
  lifecyclePaths,
} from "@workspace/domain/lifecycle-proof"
import type { StoredProjectResource } from "@workspace/domain/project-resources"
import { redactLifecycleError } from "./lifecycle-errors"
import { LifecycleProvider } from "./lifecycle-provider"
import { createLifecycleScenario, actionOrder } from "./lifecycle-scenario"
import { phaseApprovalDigest, requireLifecycleRun } from "./lifecycle"
import { requireReleaseRequest } from "./lifecycle-release"

const root = resolve(import.meta.dirname, "../..")
const run: CombinedSmokeRun = {
  stage: "smoke-local-fixture",
  commit: "a".repeat(40),
  dirty: false,
  auth: "magic",
  status: "deployed",
  baseURL: "https://sylph-smoke-local-fixture.example.workers.dev",
  environmentPath: "/unreadable/config-must-not-be-loaded",
  template: {
    repository: "owner/starter",
    commit: "b".repeat(40),
    version: "0.2.0",
  },
}
const options = {
  organizationName: "Local fixture",
  projectName: "Local fixture",
  modelName: "Grok 4.6" as const,
  appEmail: "local@example.test",
}
const resource: StoredProjectResource = {
  account_id: "c".repeat(32),
  project_id: "project",
  scope: "preview:check:1",
  kind: "d1",
  name: "owned-db",
  resource_id: "database-id",
  generation: null,
  purpose: "application",
  state: "deleted",
}

function requestAdapter(
  respond: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): typeof fetch {
  return Object.assign(respond, { preconnect: fetch.preconnect })
}

test("scenario preparation resolves all tracked implementations and dependency order without reading credentials", async () => {
  const scenario = await createLifecycleScenario(
    root,
    run,
    "c".repeat(32),
    options
  )
  requireLifecycleRun(run, scenario, run.commit, false)
  expect(new Set(scenario.phases.map((phase) => phase.path))).toEqual(
    new Set(lifecyclePaths)
  )
  expect(scenario.phases.map((phase) => phase.path)).toEqual([...actionOrder])
  for (const phase of scenario.phases) {
    expect(await readFile(resolve(root, phase.action), "utf8")).toContain(
      `runLifecycleAction("${phase.path}"`
    )
    expect(phase.actionSha256).toMatch(/^[a-f0-9]{64}$/)
  }
  const phase = scenario.phases[0]
  if (!phase) throw new Error("Missing setup action")
  expect(
    phaseApprovalDigest(
      {
        ...scenario,
        options: { ...options, projectName: "Different mutation target" },
      },
      phase
    )
  ).not.toBe(phaseApprovalDigest(scenario, phase))
  expect(() =>
    Schema.decodeUnknownSync(LifecycleActionOptions)({
      ...options,
      modelName: "unbounded model",
    })
  ).toThrow()
})

test("create command writes a private usable scenario and refuses to overwrite existing evidence", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "sylph-local-proof-"))
  try {
    const record = resolve(directory, "run.json")
    const config = resolve(directory, "options.json")
    const scenario = resolve(directory, "scenario.json")
    await writeFile(record, JSON.stringify(run))
    await writeFile(config, JSON.stringify(options))
    const args = [
      "bun",
      "scripts/lifecycle-proof.ts",
      "create",
      "--run",
      record,
      "--options",
      config,
      "--scenario",
      scenario,
      "--account-id",
      "c".repeat(32),
    ]
    const child = Bun.spawn(args, { cwd: root, stdout: "pipe", stderr: "pipe" })
    const stderr = await new Response(child.stderr).text()
    expect(await child.exited, stderr).toBe(0)
    expect(JSON.parse(await readFile(scenario, "utf8")).phases).toHaveLength(
      lifecyclePaths.length
    )
    const retry = Bun.spawn(args, { cwd: root, stdout: "pipe", stderr: "pipe" })
    await new Response(retry.stderr).text()
    expect(await retry.exited).not.toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)

test("provider adapter executes bound read-only SQL and records the actual response", async () => {
  const calls: Array<{ url: string; method: string; body: string }> = []
  const provider = new LifecycleProvider(
    "c".repeat(32),
    "local-fixture-token",
    requestAdapter(async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: String(init?.body ?? ""),
      })
      return Response.json({
        success: true,
        result: [{ success: true, results: [{ completed: 1 }] }],
      })
    })
  )
  const rows = await provider.rows(
    "db",
    "SELECT completed FROM todos WHERE title = ?",
    Schema.JsonObject,
    ["' quoted title"]
  )
  expect(rows).toEqual([{ completed: 1 }])
  expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
    sql: "SELECT completed FROM todos WHERE title = ?",
    params: ["' quoted title"],
  })
  expect(provider.requests[0]?.body).toEqual({
    success: true,
    result: [{ success: true, results: [{ completed: 1 }] }],
  })
  await expect(
    provider.rows("db", "DELETE FROM todos", Schema.JsonObject)
  ).rejects.toThrow("SELECT")
  await expect(provider.read("https://foreign.example/token")).rejects.toThrow()
  expect(calls).toHaveLength(1)
})

test("provider adapter rejects inner D1 failure and malformed result rows", async () => {
  const failed = new LifecycleProvider(
    "c".repeat(32),
    "fixture",
    requestAdapter(async () =>
      Response.json({
        success: true,
        result: [{ success: false, results: [] }],
      })
    )
  )
  await expect(
    failed.rows("db", "SELECT 1", Schema.JsonObject)
  ).rejects.toThrow()
  const invalid = new LifecycleProvider(
    "c".repeat(32),
    "fixture",
    requestAdapter(async () =>
      Response.json({
        success: true,
        result: [{ success: true, results: [{ completed: "made-up" }] }],
      })
    )
  )
  await expect(
    invalid.rows(
      "db",
      "SELECT completed FROM todos",
      Schema.Struct({ completed: Schema.Int })
    )
  ).rejects.toThrow()
})

test("cleanup absence requires an accessible provider collection and checks all pages", async () => {
  const paths: string[] = []
  const visible = new LifecycleProvider(
    "c".repeat(32),
    "fixture",
    requestAdapter(async (input) => {
      paths.push(String(input))
      const page = new URL(String(input)).searchParams.get("page")
      return Response.json({
        success: true,
        result: page === "1" ? [] : [{ uuid: "database-id", name: "owned-db" }],
        result_info: { total_pages: 2 },
      })
    })
  )
  await expect(visible.assertResourceStates([resource], true)).rejects.toThrow(
    "still exists"
  )
  expect(paths).toHaveLength(2)
  const denied = new LifecycleProvider(
    "c".repeat(32),
    "fixture",
    requestAdapter(async () =>
      Response.json(
        { success: false, errors: [{ code: 10000 }] },
        { status: 403 }
      )
    )
  )
  await expect(denied.assertResourceStates([resource], true)).rejects.toThrow(
    "403"
  )
  const absent = new LifecycleProvider(
    "c".repeat(32),
    "fixture",
    requestAdapter(async () =>
      Response.json({
        success: true,
        result: [],
        result_info: { total_pages: 1 },
      })
    )
  )
  await absent.assertResourceStates([resource], true)
  await expect(absent.assertResourceStates([resource], false)).rejects.toThrow(
    "missing"
  )
})

test("resource identity replacement and malformed provider evidence cannot become proof", async () => {
  const provider = new LifecycleProvider(
    "c".repeat(32),
    "fixture",
    requestAdapter(async () =>
      Response.json({
        success: true,
        result: [{ uuid: "replacement", name: "owned-db" }],
        result_info: { total_pages: 1 },
      })
    )
  )
  await expect(
    provider.assertResourceStates([resource], false)
  ).rejects.toThrow("changed")
  expect(() =>
    Schema.decodeUnknownSync(LifecycleProviderEvidence)({
      identity: {
        sourceCommit: run.commit,
        templateCommit: run.template.commit,
        stage: run.stage,
      },
      path: "application-restore",
      requests: [],
      assertions: [],
    })
  ).toThrow()
})

const releaseWire = (
  commit: string,
  recoveryId?: string,
  confirmedDataLoss = true
) =>
  JSON.stringify({
    t: {
      t: 10,
      p: {
        k: ["data"],
        v: [
          {
            t: 10,
            p: {
              k: [
                "projectId",
                "commit",
                "confirmedCommit",
                "idempotencyKey",
                "recoveryDeploymentId",
                "confirmedDataLoss",
              ],
              v: [
                { t: 1, s: "project" },
                { t: 1, s: commit },
                { t: 1, s: commit },
                { t: 1, s: "request" },
                recoveryId ? { t: 1, s: recoveryId } : { t: 2, s: 1 },
                { t: 2, s: confirmedDataLoss ? 2 : 3 },
              ],
            },
          },
        ],
      },
    },
  })

test("release adapter decodes actual TanStack wire fields before sending the reviewed mutation", () => {
  expect(() =>
    requireReleaseRequest(
      releaseWire(run.commit, "reviewed-point"),
      "project",
      run.commit,
      "reviewed-point"
    )
  ).not.toThrow()
  expect(() =>
    requireReleaseRequest(releaseWire(run.commit), "project", run.commit)
  ).not.toThrow()
  expect(() =>
    requireReleaseRequest(
      releaseWire(run.commit, "other-point"),
      "project",
      run.commit,
      "reviewed-point"
    )
  ).toThrow()
  expect(() =>
    requireReleaseRequest(
      releaseWire(run.commit, "reviewed-point", false),
      "project",
      run.commit,
      "reviewed-point"
    )
  ).toThrow()
  expect(() =>
    requireReleaseRequest(
      releaseWire(run.commit),
      "foreign-project",
      run.commit
    )
  ).toThrow()
  expect(() => requireReleaseRequest(null, "project", run.commit)).toThrow()
  expect(() =>
    requireReleaseRequest(releaseWire("b".repeat(40)), "project", run.commit)
  ).toThrow()
  expect(() =>
    requireReleaseRequest(
      JSON.stringify({
        extra: run.commit,
        ...JSON.parse(releaseWire("b".repeat(40))),
      }),
      "project",
      run.commit
    )
  ).toThrow()
})

test("browser failure messages cannot echo saved credentials", () => {
  expect(
    redactLifecycleError(
      'locator.fill("fixture-password"): failed for fixture-token',
      ["fixture-password", "fixture-token", ""]
    )
  ).toBe('locator.fill("[redacted]"): failed for [redacted]')
})

test("R2 proof reads actual bytes and metadata across paginated results", async () => {
  const paths: string[] = []
  const provider = new LifecycleProvider(
    "c".repeat(32),
    "fixture",
    requestAdapter(async (input) => {
      const url = new URL(String(input))
      paths.push(url.pathname + url.search)
      if (url.pathname.endsWith("/lifecycle-proof.txt"))
        return new Response("actual-body")
      return Response.json({
        success: true,
        result: url.searchParams.has("cursor")
          ? [
              {
                key: "lifecycle-proof.txt",
                custom_metadata: { version: "actual-version" },
                http_metadata: { contentType: "text/plain" },
              },
            ]
          : [],
        result_info: url.searchParams.has("cursor")
          ? { is_truncated: false }
          : { is_truncated: true, cursor: "page+2" },
      })
    })
  )
  expect(
    await provider.object("fixture-bucket", "lifecycle-proof.txt")
  ).toEqual({
    body: "actual-body",
    customMetadata: { version: "actual-version" },
    httpMetadata: { contentType: "text/plain" },
  })
  expect(paths).toHaveLength(3)
  expect(paths[2]).toContain("cursor=page%2B2")
  expect(provider.requests[0]?.body).toMatchObject({ body: "actual-body" })
  await expect(
    provider.object("../../foreign", "lifecycle-proof.txt")
  ).rejects.toThrow()
  await expect(
    provider.object("fixture-bucket", "../foreign")
  ).rejects.toThrow()
})

test("R2 proof refuses inaccessible objects and malformed pagination", async () => {
  const denied = new LifecycleProvider(
    "c".repeat(32),
    "fixture",
    requestAdapter(async () => new Response("denied", { status: 403 }))
  )
  await expect(
    denied.object("fixture-bucket", "lifecycle-proof.txt")
  ).rejects.toThrow("403")
  const missing = new LifecycleProvider(
    "c".repeat(32),
    "fixture",
    requestAdapter(async (input) =>
      String(input).includes("?")
        ? Response.json({
            success: true,
            result: [],
            result_info: { is_truncated: true },
          })
        : new Response("bytes")
    )
  )
  await expect(
    missing.object("fixture-bucket", "lifecycle-proof.txt")
  ).rejects.toThrow("pagination")
})
