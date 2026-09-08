import {
  CloudflareObjects,
  CloudflareDurableObjects,
  CloudflareContainerApplications,
  CloudflareWorkflows,
  type ProjectResourcePlan,
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
    case "durable_object":
      return "workers/durable_objects/namespaces"
    case "workflow":
      return "workflows"
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
  if (method === "DELETE" && response.status === 204)
    return { success: true, result: null }
  const raw = await response.text()
  if (method === "DELETE" && !raw) return { success: true, result: null }
  const body = Schema.decodeUnknownSync(CloudflareResourceResponse)(
    JSON.parse(raw)
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
    className?: string
  }> = []
  let cursor = ""
  let namespaceTotal: number | undefined
  let namespacePageSize: number | undefined
  const namespaceIds = new Set<string>()
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
          className: undefined,
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
      kind === "durable_object"
        ? Schema.decodeUnknownSync(CloudflareDurableObjects)(body.result).map(
            (item) => ({
              id: item.id,
              name: `${item.script}/${item.class}`,
              service: item.script,
              className: item.class,
            })
          )
        : kind === "workflow"
          ? Schema.decodeUnknownSync(CloudflareWorkflows)(body.result).map(
              (item) => ({
                id: item.id,
                name: item.name,
                service: item.script_name,
                className: item.class_name,
                generation: item.created_on,
              })
            )
          : kind === "worker"
            ? Schema.decodeUnknownSync(CloudflareWorkers)(body.result).map(
                ({ id, created_on }) => ({
                  id,
                  name: id,
                  generation: created_on,
                })
              )
            : kind === "d1"
              ? Schema.decodeUnknownSync(CloudflareDatabases)(body.result).map(
                  ({ uuid, name }) => ({ id: uuid, name })
                )
              : kind === "kv"
                ? Schema.decodeUnknownSync(CloudflareNamespaces)(
                    body.result
                  ).map(({ id, title }) => ({ id, name: title }))
                : Schema.decodeUnknownSync(CloudflareQueues)(body.result).map(
                    ({ queue_id, queue_name }) => ({
                      id: queue_id,
                      name: queue_name,
                    })
                  )
    if (kind === "durable_object") {
      const info = body.result_info
      if (
        !info ||
        info.page !== page ||
        info.count !== items.length ||
        info.per_page === undefined ||
        !Number.isSafeInteger(info.per_page) ||
        info.per_page < 1 ||
        info.per_page > 1000 ||
        info.total_count === undefined ||
        !Number.isSafeInteger(info.total_count) ||
        info.total_count < 0 ||
        Math.ceil(info.total_count / info.per_page) > 1000 ||
        (info.total_pages !== undefined &&
          (!Number.isSafeInteger(info.total_pages) ||
            info.total_pages < 0 ||
            (info.total_pages !== Math.ceil(info.total_count / info.per_page) &&
              !(info.total_count === 0 && info.total_pages === 1)))) ||
        (namespaceTotal !== undefined && namespaceTotal !== info.total_count) ||
        (namespacePageSize !== undefined &&
          namespacePageSize !== info.per_page) ||
        items.length !==
          Math.min(info.per_page, info.total_count - resources.length)
      )
        throw new Error("Cloudflare namespace pagination is incomplete")
      namespaceTotal = info.total_count
      namespacePageSize = info.per_page
      for (const item of items) {
        if (!item.id || namespaceIds.has(item.id))
          throw new Error("Cloudflare namespace identities are incomplete")
        namespaceIds.add(item.id)
      }
    }
    resources.push(...items)
    if (kind === "durable_object") {
      if (resources.length === namespaceTotal) return resources
      continue
    }
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

export const readWorkerSettings = async (
  credentials: ResourceCredentials,
  worker: string,
  request: ResourceRequest = fetch
) => {
  const body = await cloudflareResourceRequest(
    credentials,
    `workers/scripts/${encodeURIComponent(worker)}/settings`,
    request
  )
  return Schema.decodeUnknownSync(CloudflareWorkerBindings)(body.result)
}

export const readWorkerBindings = async (
  credentials: ResourceCredentials,
  worker: string,
  request: ResourceRequest = fetch
) => (await readWorkerSettings(credentials, worker, request)).bindings

type WorkerBinding = (typeof CloudflareWorkerBindings.Type.bindings)[number]

export const bindingReferencesResource = (
  binding: WorkerBinding,
  resource: StoredProjectResource,
  worker: string
) => {
  switch (binding.type) {
    case "d1":
      return resource.kind === "d1" && resource.resource_id === binding.id
    case "kv_namespace":
      return (
        resource.kind === "kv" && resource.resource_id === binding.namespace_id
      )
    case "r2_bucket":
      return resource.kind === "r2" && resource.name === binding.bucket_name
    case "queue":
      return resource.kind === "queue" && resource.name === binding.queue_name
    case "service":
      return resource.kind === "worker" && resource.name === binding.service
    case "workflow":
      return (
        resource.kind === "workflow" && resource.name === binding.workflow_name
      )
    case "durable_object_namespace":
      return (
        resource.kind === "durable_object" &&
        (resource.resource_id === binding.namespace_id ||
          resource.name ===
            `${binding.script_name ?? worker}/${binding.class_name}`)
      )
    default:
      return false
  }
}

export const verifyWorkerResources = async (
  credentials: ResourceCredentials,
  resources: ReadonlyArray<StoredProjectResource>,
  request: ResourceRequest = fetch,
  plan: ProjectResourcePlan = []
) => {
  await rejectContainerNamespaces(credentials, resources, request)
  for (const worker of resources.filter(
    (resource) => resource.kind === "worker" && resource.state === "active"
  )) {
    const settings = await readWorkerSettings(credentials, worker.name, request)
    if (settings.containers?.length || settings.tail_consumers?.length)
      throw new Error(
        `Worker ${worker.name} has Containers or tail consumers outside supported management; detach them first`
      )
    const bindings = settings.bindings
    const declared =
      plan.find(
        (resource) =>
          resource.kind === "worker" && resource.name === worker.name
      )?.bindings ?? []
    for (const binding of bindings) {
      if (
        binding.name === "SYLPH_RECOVERY_CONTROL" &&
        (binding.type !== "d1" ||
          !resources.some(
            (resource) =>
              resource.kind === "d1" &&
              resource.resource_id === binding.id &&
              resource.purpose === "recovery_control"
          ))
      )
        throw new Error(
          "SYLPH_RECOVERY_CONTROL requires a separate D1 claim with purpose recovery_control; update the resource plan before deployment"
        )
      if (["plain_text", "secret_text", "assets"].includes(binding.type))
        continue
      if (
        binding.environment ||
        binding.namespace ||
        binding.dispatch_namespace ||
        binding.jurisdiction
      )
        throw new Error(
          `Binding ${binding.name} uses an unsupported environment, dispatch namespace, or jurisdiction; use same-account default resources`
        )
      const reference = declared.find(
        (item) => item.name === binding.name && item.type === binding.type
      )
      if (binding.type === "ai" && reference) continue
      const owned = resources.find(
        (resource) =>
          resource.state === "active" &&
          bindingReferencesResource(binding, resource, worker.name)
      )
      if (!owned)
        throw new Error(
          `Worker binding ${binding.name} (${binding.type}) is unsupported or outside the reserved resource plan; declare a supported owned resource`
        )
      if (
        ["durable_object_namespace", "workflow", "service"].includes(
          binding.type
        )
      ) {
        if (
          !reference ||
          reference.target !== owned.name ||
          (reference.entrypoint ?? undefined) !==
            (binding.entrypoint ?? undefined)
        )
          throw new Error(
            `Binding ${binding.name} does not match the reviewed target or entrypoint`
          )
        const target = plan.find(
          (item) => item.kind === owned.kind && item.name === owned.name
        )
        if (
          binding.type === "durable_object_namespace" &&
          (binding.namespace_id !== owned.resource_id ||
            (binding.script_name ?? worker.name) !== target?.worker ||
            (binding.class_name !== undefined &&
              binding.class_name !== target?.className))
        )
          throw new Error(
            `Durable Object binding ${binding.name} has a different namespace, host, or class`
          )
        if (
          binding.type === "workflow" &&
          ((binding.script_name ?? worker.name) !== target?.worker ||
            (binding.class_name !== undefined &&
              binding.class_name !== target?.className))
        )
          throw new Error(
            `Workflow binding ${binding.name} has a different host or class`
          )
      }
    }
    for (const binding of declared) {
      if (
        !bindings.some(
          (item) => item.name === binding.name && item.type === binding.type
        )
      )
        throw new Error(
          `Declared binding ${binding.name} was not deployed on ${worker.name}`
        )
    }
  }
}

export const rejectContainerNamespaces = async (
  credentials: ResourceCredentials,
  resources: ReadonlyArray<StoredProjectResource>,
  request: ResourceRequest = fetch
) => {
  const namespaces = resources.filter(
    (item) => item.kind === "durable_object" && item.state !== "deleted"
  )
  if (!namespaces.length) return
  const response = await request(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(credentials.accountId)}/containers/applications`,
    { headers: { authorization: `Bearer ${credentials.token}` } }
  )
  if (!response.ok)
    throw new Error(
      `Container attachment inspection failed with HTTP ${response.status}; resource inspection needs Workers Containers Read permission`
    )
  const applications = Schema.decodeUnknownSync(
    CloudflareContainerApplications
  )(await response.json())
  for (const application of applications) {
    if (
      namespaces.some(
        (item) => item.resource_id === application.durable_objects?.namespace_id
      )
    )
      throw new Error(
        `Container application ${application.id} is attached to a selected Durable Object; Containers are outside supported Project resource management`
      )
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
