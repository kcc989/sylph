import { readFile } from "node:fs/promises"
import { Schema } from "effect"
import {
  ProjectResourcePlan,
  StoredProjectResource,
} from "@workspace/domain/project-resources"
import { findResource } from "../../apps/web/src/server/project-resources"
import { verifyWorkerResources } from "../../apps/web/src/server/cloudflare-resources"
import { validateResourceTopology } from "../../apps/web/src/server/resource-policy"

const path = process.argv[2]
if (!path || process.argv.length !== 3)
  throw new Error(
    "Usage: bun tools/resource-management/inspect.ts <plan.json>. This command only reads Cloudflare resources."
  )
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const token = process.env.RESOURCE_TOKEN
if (!accountId || !token)
  throw new Error(
    "Configure CLOUDFLARE_ACCOUNT_ID and RESOURCE_TOKEN in the approved environment; no credentials are accepted in arguments"
  )
const plan = validateResourceTopology(
  Schema.decodeUnknownSync(ProjectResourcePlan, { onExcessProperty: "error" })(
    JSON.parse(await readFile(path, "utf8"))
  )
)
const credentials = { accountId, token }
const inventory: StoredProjectResource[] = []
for (const resource of plan) {
  const live = await findResource(credentials, resource, fetch)
  if (!live)
    throw new Error(`Missing resource: ${resource.kind} ${resource.name}`)
  if (
    ["durable_object", "workflow"].includes(resource.kind) &&
    (resource.worker !== live.service || resource.className !== live.className)
  )
    throw new Error(`Host or class mismatch: ${resource.name}`)
  inventory.push({
    account_id: accountId,
    project_id: "inspection-only",
    scope: "inspection-only",
    kind: resource.kind,
    name: resource.name,
    resource_id: live.id,
    generation: live.generation ?? null,
    purpose: resource.purpose ?? "application",
    state: "active",
  })
}
await verifyWorkerResources(credentials, inventory, fetch, plan)
process.stdout.write(
  `${JSON.stringify({ evidence: "Provider identity and bindings only; Project ownership and lifecycle execution are not verified", inventory }, null, 2)}\n`
)
