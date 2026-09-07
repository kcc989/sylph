import {
  CloudflareObjects,
  CloudflareDomains,
  CloudflareBuckets,
  CloudflareDatabases,
  CloudflareNamespaces,
  CloudflareQueues,
  CloudflareResourceResponse,
  CloudflareWorkers,
  CloudflareWorkerBindings,
  type ProjectResourceKind,
  type StoredProjectResource,
} from "@workspace/domain/project-resources"
import { Schema } from "effect"

export type ResourceRequest = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => Promise<Response>
export interface ResourceCredentials {
  accountId: string
  token: string
}

export const resourceCollectionPath = (kind: ProjectResourceKind) => {
  switch (kind) {
    case "worker":
      return "workers/scripts"
    case "d1":
      return "d1/database"
    case "kv":
      return "storage/kv/namespaces"
    case "r2":
      return "r2/buckets"
    case "queue":
      return "queues"
    case "domain":
      return "workers/domains"
  }
}

export const cloudflareResourceRequest = async (
  credentials: ResourceCredentials,
  path: string,
  request: ResourceRequest = fetch,
  method = "GET",
  requestBody?: string
) => {
  const response = await request(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(credentials.accountId)}/${path}`,
    {
      method,
      body: requestBody,
      headers: {
        authorization: `Bearer ${credentials.token}`,
        "content-type": "application/json",
      },
    }
  )
  if (!response.ok)
    throw new Error(
      `Cloudflare resource ${method} failed with HTTP ${response.status}`
    )
  const body = Schema.decodeUnknownSync(CloudflareResourceResponse)(
    await response.json()
  )
  if (!body.success)
    throw new Error(`Cloudflare resource ${method} was unsuccessful`)
  return body
}

export const listCloudflareResources = async (
  credentials: ResourceCredentials,
  kind: ProjectResourceKind,
  request: ResourceRequest = fetch
) => {
  const resources: Array<{
    id: string
    name: string
    service?: string
    generation?: string
  }> = []
  let cursor = ""
  for (let page = 1; page <= 1000; page++) {
    const query =
      kind === "worker" || kind === "domain"
        ? ""
        : kind === "r2"
          ? `?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
          : `?per_page=100&page=${page}`
    const body = await cloudflareResourceRequest(
      credentials,
      `${resourceCollectionPath(kind)}${query}`,
      request
    )
    if (kind === "domain")
      return Schema.decodeUnknownSync(CloudflareDomains)(body.result).map(
        (domain) => ({
          id: domain.id,
          name: domain.hostname,
          service: domain.service,
          generation: undefined,
        })
      )
    if (kind === "r2") {
      const result = Schema.decodeUnknownSync(CloudflareBuckets)(body.result)
      resources.push(
        ...result.buckets.map(({ name, creation_date }) => ({
          id: name,
          name,
          generation: creation_date,
        }))
      )
      const nextCursor = body.result_info?.cursor
      if (!nextCursor) return resources
      if (nextCursor === cursor)
        throw new Error("Cloudflare bucket pagination is incomplete")
      cursor = nextCursor
      continue
    }
    const items =
      kind === "worker"
        ? Schema.decodeUnknownSync(CloudflareWorkers)(body.result).map(
            ({ id, created_on }) => ({ id, name: id, generation: created_on })
          )
        : kind === "d1"
          ? Schema.decodeUnknownSync(CloudflareDatabases)(body.result).map(
              ({ uuid, name }) => ({ id: uuid, name })
            )
          : kind === "kv"
            ? Schema.decodeUnknownSync(CloudflareNamespaces)(body.result).map(
                ({ id, title }) => ({ id, name: title })
              )
            : Schema.decodeUnknownSync(CloudflareQueues)(body.result).map(
                ({ queue_id, queue_name }) => ({
                  id: queue_id,
                  name: queue_name,
                })
              )
    resources.push(...items)
    if (
      kind === "worker" ||
      (body.result_info?.total_pages !== undefined
        ? page >= body.result_info.total_pages
        : items.length < 100)
    )
      return resources
  }
  throw new Error("Cloudflare resource pagination exceeded its limit")
}

export const verifyWorkerResources = async (
  credentials: ResourceCredentials,
  resources: ReadonlyArray<StoredProjectResource>,
  request: ResourceRequest = fetch
) => {
  for (const worker of resources.filter(
    (resource) => resource.kind === "worker"
  )) {
    const body = await cloudflareResourceRequest(
      credentials,
      `workers/scripts/${encodeURIComponent(worker.name)}/settings`,
      request
    )
    const settings = Schema.decodeUnknownSync(CloudflareWorkerBindings)(
      body.result
    )
    for (const binding of settings.bindings) {
      if (["plain_text", "secret_text", "assets"].includes(binding.type))
        continue
      const owned = resources.some((resource) => {
        switch (binding.type) {
          case "d1":
            return resource.kind === "d1" && resource.resource_id === binding.id
          case "kv_namespace":
            return (
              resource.kind === "kv" &&
              resource.resource_id === binding.namespace_id
            )
          case "r2_bucket":
            return (
              resource.kind === "r2" && resource.name === binding.bucket_name
            )
          case "queue":
            return (
              resource.kind === "queue" && resource.name === binding.queue_name
            )
          default:
            return false
        }
      })
      if (!owned)
        throw new Error(
          `Worker binding ${binding.name} is unsupported or outside the reserved resource plan`
        )
    }
  }
}

export const emptyPreviewBucket = async (
  credentials: ResourceCredentials,
  name: string,
  request: ResourceRequest = fetch
) => {
  const path = `r2/buckets/${encodeURIComponent(name)}/objects`
  for (let batch = 0; batch < 100; batch++) {
    const response = await cloudflareResourceRequest(
      credentials,
      `${path}?per_page=1000`,
      request
    )
    const objects = Schema.decodeUnknownSync(CloudflareObjects)(response.result)
    if (!objects.length) return
    await cloudflareResourceRequest(
      credentials,
      path,
      request,
      "DELETE",
      JSON.stringify(objects.map((object) => object.key))
    )
  }
  throw new Error(
    "Preview bucket cleanup needs another attempt to finish deleting objects"
  )
}
