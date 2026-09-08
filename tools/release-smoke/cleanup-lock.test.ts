import { expect, test } from "bun:test"
import { changeCleanupLock, planCleanupLock } from "./cleanup-lock"

const target = {
  accountId: "account",
  databaseId: "installation",
  projectId: "project",
  scope: "preview:check:1",
  runId: "run",
  bucketName: "preview-bucket",
}
function provider() {
  const operation = {
    account_id: "account",
    project_id: "project",
    scope: target.scope,
    run_id: "run",
    plan_json: "[]",
    status: "retained",
    error: null,
    inspected_at: null,
  }
  const bucket = {
    account_id: "account",
    project_id: "project",
    scope: target.scope,
    kind: "r2",
    name: target.bucketName,
    resource_id: target.bucketName,
    generation: "2026-09-07T10:00:00.000Z",
    state: "active",
    purpose: "application",
  }
  let rules: object[] = []
  const writes: string[] = []
  let generation = bucket.generation
  let hasObject = true
  const request = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/query")) {
      const body = JSON.parse(String(init?.body))
      expect(body.sql).toStartWith("SELECT")
      expect(body.params).toEqual([
        target.accountId,
        target.projectId,
        target.scope,
      ])
      return Response.json({
        success: true,
        result: [
          {
            success: true,
            results: body.sql.includes("project_resource_operation")
              ? [operation]
              : [bucket],
          },
        ],
      })
    } else if (url.endsWith("/lock")) {
      if (init?.method === "PUT") {
        writes.push(url)
        rules = JSON.parse(String(init.body)).rules
      }
      return Response.json({ success: true, result: { rules } })
    } else if (url.includes("/objects?"))
      return Response.json({
        success: true,
        result: hasObject ? [{ key: "lifecycle-proof.txt" }] : [],
      })
    return Response.json({
      success: true,
      result: { name: target.bucketName, creation_date: generation },
    })
  }
  return {
    access: {
      accountId: "account",
      token: "private",
      request: Object.assign(request, { preconnect: fetch.preconnect }),
    },
    operation,
    bucket,
    writes,
    setRules: (value: object[]) => {
      rules = value
    },
    getRules: () => rules,
    replaceBucket: () => {
      generation = "replacement"
    },
    removeObject: () => {
      hasObject = false
    },
  }
}

test("planning is read only; provider lock is installed and removed with verified identity", async () => {
  const p = provider()
  const plan = await planCleanupLock(p.access, target)
  expect(p.writes).toHaveLength(0)
  const installed = await changeCleanupLock(p.access, plan, "install")
  expect(installed.observedRules).toHaveLength(1)
  p.operation.status = "cleanup_failed"
  await changeCleanupLock(p.access, plan, "remove")
  expect(p.getRules()).toEqual([])
  expect(p.writes).toHaveLength(2)
})

test("rejects production scope, wrong account, missing fixture, and preexisting locks", async () => {
  const p = provider()
  await expect(
    planCleanupLock(p.access, { ...target, scope: "production" })
  ).rejects.toThrow("Preview attempt")
  await expect(
    planCleanupLock(p.access, { ...target, accountId: "other" })
  ).rejects.toThrow("exact account")
  p.setRules([{ id: "customer-retention" }])
  await expect(planCleanupLock(p.access, target)).rejects.toThrow("already has")
  p.setRules([])
  p.removeObject()
  await expect(planCleanupLock(p.access, target)).rejects.toThrow(
    "Create lifecycle-proof.txt"
  )
  expect(p.writes).toHaveLength(0)
})

test("rejects changed provider generation and stale operation before mutation", async () => {
  const p = provider()
  const plan = await planCleanupLock(p.access, target)
  p.operation.run_id = "new-run"
  await expect(changeCleanupLock(p.access, plan, "install")).rejects.toThrow(
    "operation identity"
  )
  p.operation.run_id = "run"
  p.replaceBucket()
  await expect(changeCleanupLock(p.access, plan, "install")).rejects.toThrow(
    "provider identity"
  )
  expect(p.writes).toHaveLength(0)
})

test("expired setup is rejected and removal preserves unrelated rules", async () => {
  const p = provider()
  const plan = await planCleanupLock(p.access, target)
  await expect(
    changeCleanupLock(p.access, plan, "install", Date.parse(plan.expiresAt))
  ).rejects.toThrow("expired")
  await changeCleanupLock(p.access, plan, "install")
  const foreign = {
    id: "foreign",
    enabled: true,
    condition: { type: "Indefinite" },
  }
  p.setRules([...p.getRules(), foreign])
  await changeCleanupLock(
    p.access,
    plan,
    "remove",
    Date.parse(plan.expiresAt) + 1
  )
  expect(p.getRules()).toEqual([foreign])
})

test("rule drift is never overwritten", async () => {
  const p = provider()
  const plan = await planCleanupLock(p.access, target)
  p.setRules([{ id: plan.ruleId, enabled: false }])
  await expect(changeCleanupLock(p.access, plan, "remove")).rejects.toThrow(
    "rule changed"
  )
  expect(p.writes).toHaveLength(0)
})
