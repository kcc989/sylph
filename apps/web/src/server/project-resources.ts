import { removeOwnedResources } from "./resource-removal"
import { entryWorker, validateResourceTopology } from "./resource-policy"
import {
  ProjectResourceOperation,
  ProjectResourcePlan,
  StoredProjectResource,
  type PlannedProjectResource,
} from "@workspace/domain/project-resources"
import { Schema } from "effect"
import {
  listCloudflareResources,
  verifyWorkerResources,
  type ResourceCredentials,
  type ResourceRequest,
} from "./cloudflare-resources"

interface ResourceStatement {
  bind(...values: Array<string | null>): ResourceStatement
  all<T>(): Promise<{ results: T[] }>
  first<T>(): Promise<T | null>
  run(): Promise<{ success?: boolean }>
}
export interface ResourceDatabase {
  prepare(sql: string): ResourceStatement
  batch(statements: ResourceStatement[]): Promise<Array<{ success?: boolean }>>
}
export interface ResourceOwner {
  projectId: string
  scope: string
  runId: string
}

export const resourcePrefix = async (projectId: string, scope: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${projectId}:${scope}`)
  )
  return `sylph-${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  )
    .join("")
    .slice(0, 24)}`
}

export const readResourcePlan = (
  output: string,
  prefix: string,
  customDomain = ""
) => {
  const lines = output
    .split("\n")
    .filter((line) => line.startsWith("SYLPH_RESOURCE_PLAN="))
  const line = lines[0]
  if (lines.length !== 1 || !line)
    throw new Error("sylph:plan must print one SYLPH_RESOURCE_PLAN JSON array")
  const plan = Schema.decodeUnknownSync(ProjectResourcePlan, {
    onExcessProperty: "error",
  })(JSON.parse(line.slice("SYLPH_RESOURCE_PLAN=".length)))
  validateResourceTopology(plan)
  const domains = plan.filter((resource) => resource.kind === "domain")
  if (
    domains.length !== (customDomain ? 1 : 0) ||
    domains.some((resource) => resource.name !== customDomain)
  )
    throw new Error(
      "The plan must match the configured production custom domain"
    )
  const names = new Set<string>()
  for (const resource of plan) {
    if (
      resource.kind !== "domain" &&
      resource.kind !== "durable_object" &&
      !resource.adopted &&
      (!resource.name.startsWith(`${prefix}-`) ||
        !/^[a-z0-9][a-z0-9-]{0,62}$/.test(resource.name))
    ) {
      throw new Error(
        `Resource ${resource.name} must use the reserved prefix ${prefix}- and at most 63 characters`
      )
    }
    const key = `${resource.kind}:${resource.name}`
    if (names.has(key)) throw new Error(`Duplicate resource ${resource.name}`)
    names.add(key)
  }
  return plan
}

export const readProjectResources = async (
  database: ResourceDatabase,
  projectId: string
) => {
  const rows = await database
    .prepare(
      "SELECT * FROM project_resource WHERE project_id = ? ORDER BY scope, kind, name"
    )
    .bind(projectId)
    .all()
  return Schema.decodeUnknownSync(Schema.Array(StoredProjectResource))(
    rows.results
  )
}

export const scopeResources = async (
  database: ResourceDatabase,
  credentials: ResourceCredentials,
  owner: ResourceOwner
) =>
  (await readProjectResources(database, owner.projectId)).filter(
    (resource) =>
      resource.account_id === credentials.accountId &&
      resource.scope === owner.scope
  )

export const findResource = async (
  credentials: ResourceCredentials,
  resource: PlannedProjectResource,
  request: ResourceRequest
) => {
  const matches = (
    await listCloudflareResources(credentials, resource.kind, request)
  ).filter((item) => item.name === resource.name)
  if (matches.length > 1)
    throw new Error(`Resource name ${resource.name} is ambiguous`)
  return matches[0]
}

const namespacedResources = async (
  credentials: ResourceCredentials,
  owner: ResourceOwner,
  request: ResourceRequest
) => {
  const prefix = await resourcePrefix(owner.projectId, owner.scope)
  const kinds = [
    "worker",
    "d1",
    "kv",
    "r2",
    "queue",
    "durable_object",
    "workflow",
  ] as const
  const resources = []
  for (const kind of kinds) {
    for (const resource of await listCloudflareResources(
      credentials,
      kind,
      request
    )) {
      if (resource.name.startsWith(`${prefix}-`))
        resources.push({ ...resource, kind })
    }
  }
  return resources
}

export const reserveProjectResources = async (
  database: ResourceDatabase,
  credentials: ResourceCredentials,
  owner: ResourceOwner,
  plan: ProjectResourcePlan,
  request: ResourceRequest = fetch
) => {
  validateResourceTopology(plan)
  const previous = await scopeResources(database, credentials, owner)
  for (const resource of plan) {
    const claim = previous.find(
      (item) => item.kind === resource.kind && item.name === resource.name
    )
    if (claim?.state === "retired" || claim?.state === "deleted")
      throw new Error(`Resource ${resource.name} was retired; use a new name`)
    if (
      resource.adopted &&
      (owner.scope !== "production" || claim?.state !== "active")
    )
      throw new Error(
        `Resource ${resource.name} requires explicit reviewed production adoption`
      )
    if (
      claim &&
      (claim.purpose ?? "application") !== (resource.purpose ?? "application")
    )
      throw new Error(`Resource purpose cannot change for ${resource.name}`)
  }
  if (owner.scope === "production" && !previous.length) {
    const deployed = await database
      .prepare(
        "SELECT id FROM deployment WHERE project_id = ? AND status = 'succeeded' LIMIT 1"
      )
      .bind(owner.projectId)
      .first<{ id: string }>()
    if (deployed)
      throw new Error(
        "This Project has an existing production deployment without an inventory; review and adopt its resources before deploying"
      )
  }
  for (const existing of await namespacedResources(
    credentials,
    owner,
    request
  )) {
    if (
      !previous.some(
        (claim) =>
          claim.kind === existing.kind &&
          claim.name === existing.name &&
          claim.resource_id === existing.id &&
          claim.generation === (existing.generation ?? null) &&
          claim.state !== "deleted"
      )
    )
      throw new Error(
        `Resource ${existing.name} already exists without matching Project ownership`
      )
  }
  for (const resource of plan) {
    const existing = await findResource(credentials, resource, request)
    const claim = previous.find(
      (item) => item.kind === resource.kind && item.name === resource.name
    )
    if (
      existing &&
      ["durable_object", "workflow"].includes(resource.kind) &&
      (existing.service !== resource.worker ||
        existing.className !== resource.className)
    )
      throw new Error(
        `Resource host or class changed for ${resource.name}; review its migration before deployment`
      )
    if (!existing && claim?.resource_id && claim.state !== "deleted")
      throw new Error(
        `Owned resource ${resource.name} is missing; reconcile it before deploying`
      )
    if (
      existing &&
      (!claim ||
        claim.state === "deleted" ||
        claim.resource_id !== existing.id ||
        claim.generation !== (existing.generation ?? null))
    ) {
      throw new Error(
        `Resource ${resource.name} already exists without matching Project ownership`
      )
    }
  }
  if (
    previous.some(
      (resource) =>
        resource.state !== "deleted" &&
        resource.state !== "retired" &&
        !plan.some(
          (item) => item.kind === resource.kind && item.name === resource.name
        )
    )
  ) {
    throw new Error(
      "The resource plan removes owned resources; retire them before changing the plan"
    )
  }
  await database.batch([
    database
      .prepare(`INSERT INTO project_resource_operation (account_id, project_id, scope, run_id, plan_json, status)
      VALUES (?, ?, ?, ?, ?, 'deploying') ON CONFLICT(account_id, project_id, scope) DO UPDATE SET
      run_id = CASE WHEN project_resource_operation.status = 'complete' OR
        (project_resource_operation.run_id = excluded.run_id AND project_resource_operation.status = 'deploying' AND project_resource_operation.plan_json = excluded.plan_json)
        THEN excluded.run_id ELSE NULL END, plan_json = excluded.plan_json, status = 'deploying', error = NULL`)
      .bind(
        credentials.accountId,
        owner.projectId,
        owner.scope,
        owner.runId,
        JSON.stringify(plan)
      ),
    ...plan.map((resource) =>
      database
        .prepare(`INSERT INTO project_resource (account_id, project_id, scope, kind, name, purpose)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, kind, name) DO UPDATE SET
      project_id = CASE WHEN project_resource.project_id = excluded.project_id AND project_resource.scope = excluded.scope
        AND project_resource.state != 'deleted' THEN excluded.project_id ELSE NULL END`)
        .bind(
          credentials.accountId,
          owner.projectId,
          owner.scope,
          resource.kind,
          resource.name,
          resource.purpose ?? "application"
        )
    ),
  ])
}

export const captureProjectResources = async (
  database: ResourceDatabase,
  credentials: ResourceCredentials,
  owner: ResourceOwner,
  requireComplete: boolean,
  request: ResourceRequest = fetch
) => {
  const operation = Schema.decodeUnknownSync(ProjectResourceOperation)(
    await database
      .prepare(
        "SELECT * FROM project_resource_operation WHERE account_id = ? AND project_id = ? AND scope = ? AND run_id = ?"
      )
      .bind(credentials.accountId, owner.projectId, owner.scope, owner.runId)
      .first()
  )
  if (operation.status === "deleted")
    return scopeResources(database, credentials, owner)
  const declared = Schema.decodeUnknownSync(ProjectResourcePlan)(
    JSON.parse(operation.plan_json)
  )
  for (const discovered of await namespacedResources(
    credentials,
    owner,
    request
  )) {
    if (
      !declared.some(
        (item) => item.kind === discovered.kind && item.name === discovered.name
      ) &&
      !(await scopeResources(database, credentials, owner)).some(
        (item) =>
          item.kind === discovered.kind &&
          item.name === discovered.name &&
          item.resource_id === discovered.id &&
          item.state === "retired"
      )
    )
      throw new Error(
        `Undeclared resource ${discovered.name} requires explicit adoption; a name prefix is not ownership`
      )
  }
  const resources = await scopeResources(database, credentials, owner)
  if (!resources.length)
    throw new Error("No reserved Project resource inventory exists")
  for (const resource of resources) {
    if (resource.state === "deleted" || resource.state === "retired") continue
    const existing = await findResource(credentials, resource, request)
    if (!existing) {
      if (requireComplete)
        throw new Error(`Declared resource ${resource.name} was not deployed`)
      continue
    }
    if (
      resource.kind === "domain" &&
      existing.service !==
        (declared.find(
          (item) => item.kind === "domain" && item.name === resource.name
        )?.worker ?? entryWorker(declared)?.name)
    )
      throw new Error("Custom domain does not route to the reserved Worker")
    const descriptor = declared.find(
      (item) => item.kind === resource.kind && item.name === resource.name
    )
    if (
      ["durable_object", "workflow"].includes(resource.kind) &&
      (existing.service !== descriptor?.worker ||
        existing.className !== descriptor?.className)
    )
      throw new Error(`Resource host or class changed for ${resource.name}`)
    if (
      resource.resource_id &&
      (resource.resource_id !== existing.id ||
        resource.generation !== (existing.generation ?? null))
    )
      throw new Error(`Resource identity changed for ${resource.name}`)
    await database
      .prepare(
        "UPDATE project_resource SET resource_id = ?, generation = ?, state = 'active' WHERE account_id = ? AND project_id = ? AND scope = ? AND kind = ? AND name = ? AND state != 'deleted'"
      )
      .bind(
        existing.id,
        existing.generation ?? null,
        credentials.accountId,
        owner.projectId,
        owner.scope,
        resource.kind,
        resource.name
      )
      .run()
  }
  const inventory = await scopeResources(database, credentials, owner)
  if (requireComplete) {
    if (
      inventory.some(
        (resource) =>
          resource.state !== "retired" &&
          resource.state !== "deleted" &&
          !declared.some(
            (item) => item.kind === resource.kind && item.name === resource.name
          )
      )
    )
      throw new Error(
        "Deployment created undeclared resources; they have been recorded for cleanup"
      )
    await verifyWorkerResources(credentials, inventory, request, declared)
    await database
      .prepare(
        "UPDATE project_resource_operation SET inspected_at = unixepoch() WHERE account_id = ? AND project_id = ? AND scope = ? AND run_id = ?"
      )
      .bind(credentials.accountId, owner.projectId, owner.scope, owner.runId)
      .run()
  }
  return inventory
}

export const finishResourceOperation = async (
  database: ResourceDatabase,
  credentials: ResourceCredentials,
  owner: ResourceOwner,
  status: ProjectResourceOperation["status"],
  error: string | null = null
) => {
  await database
    .prepare(
      "UPDATE project_resource_operation SET status = ?, error = ? WHERE account_id = ? AND project_id = ? AND scope = ? AND run_id = ? AND status != 'deleted'"
    )
    .bind(
      status,
      error,
      credentials.accountId,
      owner.projectId,
      owner.scope,
      owner.runId
    )
    .run()
}

export const removePreviewResources = async (
  database: ResourceDatabase,
  credentials: ResourceCredentials,
  owner: ResourceOwner,
  request: ResourceRequest = fetch
) => {
  if (!owner.scope.startsWith("preview:"))
    throw new Error("Preview cleanup cannot remove production resources")
  const operation = await database
    .prepare(
      "SELECT run_id, status FROM project_resource_operation WHERE account_id = ? AND project_id = ? AND scope = ?"
    )
    .bind(credentials.accountId, owner.projectId, owner.scope)
    .first<{ run_id: string; status: string }>()
  if (
    !operation ||
    operation.run_id !== owner.runId ||
    ["deploying", "maintaining"].includes(operation.status)
  )
    throw new Error("Preview deployment must stop before cleanup")
  if (operation.status === "deleted") return
  try {
    const inventory = await captureProjectResources(
      database,
      credentials,
      owner,
      false,
      request
    )
    await removeOwnedResources(
      database,
      credentials,
      owner,
      inventory.filter((resource) => resource.purpose !== "recovery_control"),
      request
    )
    await finishResourceOperation(
      database,
      credentials,
      owner,
      inventory.some((resource) => resource.purpose === "recovery_control")
        ? "complete"
        : "deleted"
    )
  } catch (cause) {
    await finishResourceOperation(
      database,
      credentials,
      owner,
      "cleanup_failed",
      cause instanceof Error ? cause.message : "Preview cleanup failed"
    )
    throw cause
  }
}

export const verifyResourceUrl = (url: string, plan: ProjectResourcePlan) => {
  const parsed = new URL(url)
  const worker = entryWorker(plan)
  if (
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    !parsed.port &&
    plan.some(
      (resource) =>
        resource.kind === "domain" && resource.name === parsed.hostname
    )
  )
    return
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hostname.split(".").length !== 4 ||
    !parsed.hostname.endsWith(".workers.dev") ||
    parsed.hostname.split(".")[0] !== worker?.name
  ) {
    throw new Error("Deployment URL does not identify the reserved Worker")
  }
}
