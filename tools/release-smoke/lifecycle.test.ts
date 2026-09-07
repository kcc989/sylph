import { expect, test } from "bun:test"
import type {
  LifecycleObservation,
  LifecycleScenario,
} from "@workspace/domain/lifecycle-proof"
import { lifecyclePaths } from "@workspace/domain/lifecycle-proof"
import {
  combinedLifecycleResult,
  phaseApprovalDigest,
  requireLifecycleRun,
  requirePhaseApproval,
  requireLifecycleProbe,
  requireProbeAssertions,
} from "./lifecycle"
import {
  requireIntegratedSource,
  requireDeployedIdentity,
} from "./identity.mjs"
import { smokeIdentityResponse } from "../../apps/web/src/server/smoke-identity"

const identity = {
  sourceCommit: "a".repeat(40),
  templateCommit: "b".repeat(40),
  stage: "smoke-combined",
}
const scenario: LifecycleScenario = {
  identity,
  accountId: "c".repeat(32),
  modelBudgetUsd: 4,
  phases: lifecyclePaths.map((path) => ({
    path,
    target: `${path} on disposable app`,
    action: `tests/release-smoke/actions/${path}.ts`,
    actionSha256: "d".repeat(64),
    timeoutSeconds: 60,
    dependsOn: [],
    probes: [
      {
        path: "d1/database/db/query",
        select: "SELECT 1 AS marker",
        assertions: [{ pointer: "/success", equals: true }],
      },
    ],
  })),
}
const run = {
  stage: identity.stage,
  commit: identity.sourceCommit,
  dirty: false,
  auth: "magic" as const,
  status: "deployed",
  baseURL: "https://smoke.example.com",
  environmentPath: "/private/config",
  template: {
    repository: "owner/starter",
    commit: identity.templateCommit,
    version: "0.2.0",
  },
}

test("combined verification rejects a changed checkout, template, stage, or missing path", () => {
  expect(() =>
    requireLifecycleRun(run, scenario, run.commit, false)
  ).not.toThrow()
  expect(() => requireLifecycleRun(run, scenario, run.commit, true)).toThrow(
    "clean checkout"
  )
  expect(() =>
    requireLifecycleRun(
      run,
      {
        ...scenario,
        identity: { ...identity, templateCommit: "e".repeat(40) },
      },
      run.commit,
      false
    )
  ).toThrow()
  expect(() =>
    requireLifecycleRun(
      run,
      { ...scenario, phases: scenario.phases.slice(1) },
      run.commit,
      false
    )
  ).toThrow("each lifecycle path")
  expect(() =>
    requireIntegratedSource(
      run.commit,
      run.commit,
      false,
      run.template,
      run.template.commit
    )
  ).not.toThrow()
  expect(() =>
    requireDeployedIdentity({ ...identity, stage: "smoke-another" }, run)
  ).toThrow("identity")
})

test("approval is tied to the exact operation, source and target", () => {
  const phase = scenario.phases.find(
    (candidate) => candidate.path === "application-restore"
  )
  if (!phase) throw new Error("Fixture has no restore phase")
  expect(() => requirePhaseApproval(scenario, phase)).toThrow(
    "Explicit approval"
  )
  const approved = phaseApprovalDigest(scenario, phase)
  expect(() => requirePhaseApproval(scenario, phase, approved)).not.toThrow()
  expect(() =>
    requirePhaseApproval(
      scenario,
      { ...phase, target: "real production" },
      approved
    )
  ).toThrow()
})

test("local receipts and missing provider evidence cannot complete a combined lifecycle", () => {
  const observations: LifecycleObservation[] = lifecyclePaths.map((path) => ({
    path,
    phaseDigest: "d".repeat(64),
    identity,
    observedAt: "2026-09-07T00:00:00.000Z",
    outcome: "passed",
    scope: "local-fixture",
    detail: "Fixture only",
    evidence: [
      { kind: "local-fixture", file: "fixture.json", sha256: "a".repeat(64) },
    ],
  }))
  expect(combinedLifecycleResult(observations).complete).toBe(false)
  expect(combinedLifecycleResult([]).paths).toHaveLength(12)
  const deployed = observations.map((observation) => ({
    ...observation,
    scope: "deployed" as const,
    evidence: [
      {
        kind: "cloudflare-api" as const,
        file: "api.json",
        sha256: "b".repeat(64),
      },
    ],
  }))
  expect(combinedLifecycleResult(deployed).complete).toBe(false)
})

test("provider probes reject writes and external URLs and compare actual values", () => {
  const probe = {
    path: "d1/database/db/query",
    select: "SELECT value FROM records",
    assertions: [{ pointer: "/result/0/value", equals: "before-restore" }],
  }
  expect(() => requireLifecycleProbe(probe)).not.toThrow()
  expect(() =>
    requireLifecycleProbe({ ...probe, select: "SELECT 1; DELETE FROM records" })
  ).toThrow()
  expect(() =>
    requireLifecycleProbe({
      ...probe,
      path: "https://elsewhere.example.com",
      select: undefined,
    })
  ).toThrow()
  expect(() =>
    requireProbeAssertions({ result: [{ value: "after-restore" }] }, probe)
  ).toThrow("differs")
  expect(() =>
    requireProbeAssertions({ result: [{ value: "before-restore" }] }, probe)
  ).not.toThrow()
})

test("the deployed identity endpoint exposes only a valid isolated-stage identity", async () => {
  const request = new Request(
    "https://smoke.example.com/__sylph/smoke-identity"
  )
  expect(smokeIdentityResponse(request, {})?.status).toBe(404)
  expect(
    smokeIdentityResponse(request, { SYLPH_SMOKE_STAGE: "prod" })?.status
  ).toBe(404)
  const response = smokeIdentityResponse(request, {
    SYLPH_SMOKE_STAGE: identity.stage,
    SYLPH_SMOKE_SOURCE_COMMIT: identity.sourceCommit,
    SYLPH_SMOKE_TEMPLATE_COMMIT: identity.templateCommit,
  })
  expect(await response?.text()).toBe(JSON.stringify(identity))
  expect(response?.headers.get("Cache-Control")).toBe("no-store")
})
