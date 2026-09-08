import { randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { Schema } from "effect"
import { RecoveryQueryResponse } from "@workspace/domain/cloudflare-recovery"
import {
  CloudflareObjects,
  CloudflareResourceResponse,
  ProjectResourceOperation,
  StoredProjectResource,
} from "@workspace/domain/project-resources"

export const CleanupLockTarget = Schema.Struct({
  accountId: Schema.NonEmptyString,
  databaseId: Schema.NonEmptyString,
  projectId: Schema.NonEmptyString,
  scope: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  bucketName: Schema.NonEmptyString,
})
export const CleanupLockPlan = Schema.Struct({
  ...CleanupLockTarget.fields,
  generation: Schema.NonEmptyString,
  objectKey: Schema.Literal("lifecycle-proof.txt"),
  ruleId: Schema.NonEmptyString,
  expiresAt: Schema.NonEmptyString,
})
type Target = typeof CleanupLockTarget.Type
type Plan = typeof CleanupLockPlan.Type
interface Access {
  accountId: string
  token: string
  request?: typeof fetch
}
const Bucket = Schema.Struct({
  name: Schema.NonEmptyString,
  creation_date: Schema.NonEmptyString,
})
const Locks = Schema.Struct({ rules: Schema.Array(Schema.JsonObject) })

async function request(
  access: Access,
  path: string,
  body?: Schema.Json,
  method = "GET"
) {
  const response = await (access.request ?? fetch)(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(access.accountId)}/${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${access.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    }
  )
  if (!response.ok)
    throw new Error(`Cleanup lock request failed (HTTP ${response.status})`)
  const envelope = Schema.decodeUnknownSync(CloudflareResourceResponse)(
    await response.json()
  )
  if (!envelope.success)
    throw new Error("Cloudflare rejected the cleanup lock request")
  return envelope
}

async function rows(access: Access, target: Target, sql: string) {
  return Schema.decodeUnknownSync(RecoveryQueryResponse)(
    await request(
      access,
      `d1/database/${encodeURIComponent(target.databaseId)}/query`,
      { sql, params: [target.accountId, target.projectId, target.scope] },
      "POST"
    )
  ).result.flatMap((item) => {
    if (!item.success) throw new Error("Cleanup identity query failed")
    return item.results
  })
}

async function inspect(access: Access, target: Target) {
  if (
    access.accountId !== target.accountId ||
    !/^preview:[^:]+:[1-9][0-9]*$/.test(target.scope)
  )
    throw new Error(
      "Cleanup lock requires the exact account and a Preview attempt scope"
    )
  const operations = Schema.decodeUnknownSync(
    Schema.Array(ProjectResourceOperation)
  )(
    await rows(
      access,
      target,
      "SELECT * FROM project_resource_operation WHERE account_id = ? AND project_id = ? AND scope = ?"
    )
  )
  const operation = operations[0]
  if (
    operations.length !== 1 ||
    !operation ||
    operation.run_id !== target.runId
  )
    throw new Error("Preview operation identity changed")
  const resources = Schema.decodeUnknownSync(
    Schema.Array(StoredProjectResource)
  )(
    await rows(
      access,
      target,
      "SELECT * FROM project_resource WHERE account_id = ? AND project_id = ? AND scope = ?"
    )
  )
  const buckets = resources.filter(
    (item) => item.kind === "r2" && item.name === target.bucketName
  )
  const bucket = buckets[0]
  if (
    buckets.length !== 1 ||
    !bucket ||
    bucket.state === "deleted" ||
    bucket.purpose === "recovery_control" ||
    bucket.resource_id !== target.bucketName ||
    !bucket.generation
  )
    throw new Error(
      "Preview bucket has no exact live application ownership claim"
    )
  const path = `r2/buckets/${encodeURIComponent(target.bucketName)}`
  const live = Schema.decodeUnknownSync(Bucket)(
    (await request(access, path)).result
  )
  if (live.name !== bucket.name || live.creation_date !== bucket.generation)
    throw new Error("Preview bucket provider identity changed")
  return { operation, bucket, path }
}

function rule(plan: Plan) {
  return {
    id: plan.ruleId,
    enabled: true,
    prefix: plan.objectKey,
    condition: { type: "Date", date: plan.expiresAt },
  }
}

export async function planCleanupLock(
  access: Access,
  target: Target,
  now = Date.now()
) {
  const { operation, bucket, path } = await inspect(access, target)
  if (operation.status !== "retained")
    throw new Error("Lock setup requires a retained Preview")
  const objects = Schema.decodeUnknownSync(CloudflareObjects)(
    (
      await request(
        access,
        `${path}/objects?prefix=lifecycle-proof.txt&per_page=1000`
      )
    ).result
  )
  if (!objects.some((item) => item.key === "lifecycle-proof.txt"))
    throw new Error(
      "Create lifecycle-proof.txt through the Preview application before planning its lock"
    )
  const locks = Schema.decodeUnknownSync(Locks)(
    (await request(access, `${path}/lock`)).result
  )
  if (locks.rules.length)
    throw new Error(
      "Preview already has bucket locks; do not replace existing retention policy"
    )
  return Schema.decodeUnknownSync(CleanupLockPlan)({
    ...target,
    generation: bucket.generation,
    objectKey: "lifecycle-proof.txt",
    ruleId: `sylph-cleanup-${randomUUID()}`,
    expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
  })
}

export async function changeCleanupLock(
  access: Access,
  plan: Plan,
  action: "install" | "remove",
  now = Date.now()
) {
  const { operation, bucket, path } = await inspect(access, plan)
  if (
    bucket.generation !== plan.generation ||
    !/^sylph-cleanup-[a-f0-9-]{36}$/.test(plan.ruleId)
  )
    throw new Error("Cleanup lock plan identity changed")
  const locks = Schema.decodeUnknownSync(Locks)(
    (await request(access, `${path}/lock`)).result
  )
  const selected = locks.rules.filter((item) => item.id === plan.ruleId)
  const expected = rule(plan)
  if (selected.some((item) => !isDeepStrictEqual(item, expected)))
    throw new Error(
      "The cleanup lock rule changed; inspect it before changing retention"
    )
  if (action === "install") {
    const remaining = Date.parse(plan.expiresAt) - now
    if (
      operation.status !== "retained" ||
      !Number.isFinite(remaining) ||
      remaining < 60_000 ||
      remaining > 2 * 60 * 60 * 1000
    )
      throw new Error("Lock plan expired or Preview is no longer retained")
    if (locks.rules.some((item) => item.id !== plan.ruleId))
      throw new Error("Another bucket lock appeared after planning")
  }
  const next =
    action === "install"
      ? [expected]
      : locks.rules.filter((item) => item.id !== plan.ruleId)
  if (!isDeepStrictEqual(locks.rules, next))
    await request(access, `${path}/lock`, { rules: next }, "PUT")
  const observed = Schema.decodeUnknownSync(Locks)(
    (await request(access, `${path}/lock`)).result
  )
  if (!isDeepStrictEqual(observed.rules, next))
    throw new Error("Provider lock rules did not match the requested change")
  return {
    action,
    accountId: plan.accountId,
    scope: plan.scope,
    bucketName: plan.bucketName,
    generation: plan.generation,
    rule: expected,
    observedRules: observed.rules,
    observedAt: new Date(now).toISOString(),
  }
}
