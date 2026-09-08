import {
  listCloudflareResources,
  type ResourceCredentials,
  type ResourceRequest,
} from "./cloudflare-resources"
import { Schema } from "effect"
import { DeploymentRecoveryPoint } from "@workspace/domain/deployments"
import type { ResourceDatabase } from "./project-resources"

export const namespaceRecoveryBlockers = async (
  database: Pick<ResourceDatabase, "prepare">,
  projectId: string,
  namespaceIds: readonly string[]
) => {
  if (!namespaceIds.length) return []
  const rows = await database
    .prepare(
      "SELECT recovery_json FROM deployment WHERE project_id = ? AND recovery_json IS NOT NULL"
    )
    .bind(projectId)
    .all<{ recovery_json: string }>()
  return rows.results.flatMap((row) => {
    const point = Schema.decodeUnknownSync(DeploymentRecoveryPoint)(
      JSON.parse(row.recovery_json)
    )
    return point.resources
      .filter(
        (item) =>
          item.kind === "durable-object" && namespaceIds.includes(item.id)
      )
      .map((item) => ({
        namespaceId: item.id,
        deploymentId: point.deploymentId,
      }))
  })
}

export const requireNamespaceAbsent = async (
  credentials: ResourceCredentials,
  namespaceId: string,
  request: ResourceRequest
) => {
  if (
    (
      await listCloudflareResources(credentials, "durable_object", request)
    ).some((item) => item.id === namespaceId)
  )
    throw new Error(
      "The original namespace still exists; inspect its current class before retirement"
    )
}
