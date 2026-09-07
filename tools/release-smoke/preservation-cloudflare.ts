import { Schema } from "effect"
import {
  type InstallationPreservationSource,
  PreservationD1Export,
  PreservationWorkerDeployments,
  PreservationWorkerSettingsResponse,
} from "@workspace/domain/installation-preservation"

export interface PreservationCloudflareAccess {
  accountId: string
  token: string
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>
}

async function request(
  access: PreservationCloudflareAccess,
  path: string,
  body?: string
) {
  const response = await (access.fetch ?? fetch)(
    `https://api.cloudflare.com/client/v4/accounts/${access.accountId}/${path}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${access.token}`,
        "Content-Type": "application/json",
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    }
  )
  if (!response.ok)
    throw new Error(
      `Cloudflare preservation request failed (HTTP ${response.status})`
    )
  return response
}

export async function inspectRetainedInstallation(
  access: PreservationCloudflareAccess,
  source: InstallationPreservationSource
) {
  if (access.accountId !== source.accountId)
    throw new Error(
      "Saved Cloudflare account differs from the preservation source"
    )
  const workers = [...new Set([source.websiteWorker, ...source.runtimeWorkers])]
  const inventory = await Promise.all(
    workers.map(async (worker) => {
      const [settingsResponse, deploymentsResponse] = await Promise.all([
        request(access, `workers/scripts/${worker}/settings`),
        request(access, `workers/scripts/${worker}/deployments`),
      ])
      const settings = Schema.decodeUnknownSync(
        PreservationWorkerSettingsResponse
      )(await settingsResponse.json())
      const deployments = Schema.decodeUnknownSync(
        PreservationWorkerDeployments
      )(await deploymentsResponse.json())
      const current = deployments.result.deployments[0]
      if (
        !settings.success ||
        !deployments.success ||
        !current?.versions.length
      )
        throw new Error("The retained Worker has no verifiable deployment")
      return {
        bindings: settings.result.bindings.map((binding) => ({
          worker,
          name: binding.name,
          type: binding.type,
          resourceId:
            binding.namespace_id ??
            binding.database_id ??
            binding.bucket_name ??
            binding.id ??
            binding.script_name ??
            null,
        })),
        version: { worker, versions: current.versions },
      }
    })
  )
  const bindings = inventory.flatMap((item) => item.bindings)
  if (
    !bindings.some(
      (binding) =>
        binding.worker === source.websiteWorker &&
        binding.type === "d1" &&
        binding.name === "DB" &&
        binding.resourceId === source.databaseId
    )
  )
    throw new Error(
      "The website DB binding does not match the requested source database"
    )
  if (
    !bindings.some(
      (binding) =>
        binding.name === "WORKSPACES" &&
        binding.type === "durable_object_namespace" &&
        binding.resourceId
    )
  )
    throw new Error(
      "No retained WORKSPACES namespace was found; include the earlier runtime Worker"
    )
  return { bindings, workerVersions: inventory.map((item) => item.version) }
}

export async function exportPreservedD1(
  access: PreservationCloudflareAccess,
  databaseId: string
) {
  let bookmark: string | undefined
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await request(
      access,
      `d1/database/${databaseId}/export`,
      JSON.stringify({ output_format: "polling", current_bookmark: bookmark })
    )
    const exported = Schema.decodeUnknownSync(PreservationD1Export)(
      await response.json()
    )
    if (!exported.success || exported.result.status === "error")
      throw new Error("D1 preservation export failed")
    if (exported.result.result?.signed_url) {
      const url = new URL(exported.result.result.signed_url)
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("D1 returned an invalid export URL")
      const download = await (access.fetch ?? fetch)(url, {
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      })
      if (!download.ok)
        throw new Error(
          `D1 preservation download failed (HTTP ${download.status})`
        )
      return download.text()
    }
    bookmark = exported.result.at_bookmark
    if (!bookmark) throw new Error("D1 export returned no polling bookmark")
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(
    "D1 export did not finish within 30 polls; the old Installation remains intact"
  )
}
