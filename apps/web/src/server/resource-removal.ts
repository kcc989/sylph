import {
  ResourcePolicyError,
  CloudflareQueueConsumers,
  type StoredProjectResource,
} from "@workspace/domain/project-resources"
import { Schema } from "effect"
import {
  bindingReferencesResource,
  cloudflareResourceRequest,
  emptyPreviewBucket,
  listCloudflareResources,
  readWorkerSettings,
  rejectContainerNamespaces,
  resourceCollectionPath,
  type ResourceCredentials,
  type ResourceRequest,
} from "./cloudflare-resources"
import {
  findResource,
  type ResourceDatabase,
  type ResourceOwner,
} from "./project-resources"

export const verifyRemovalReferences = async (
  credentials: ResourceCredentials,
  resources: ReadonlyArray<StoredProjectResource>,
  request: ResourceRequest = fetch
) => {
  const selected = resources.filter((item) => item.state !== "deleted")
  await rejectContainerNamespaces(credentials, selected, request)
  if (selected.some((item) => item.purpose === "recovery_control"))
    throw new ResourcePolicyError({
      message:
        "Recovery control has independent ownership and cannot be retired or removed with application resources",
    })
  const workers = await listCloudflareResources(credentials, "worker", request)
  for (const selectedWorker of selected.filter(
    (item) => item.kind === "worker"
  )) {
    const current = workers.find((item) => item.name === selectedWorker.name)
    if (
      current &&
      (current.id !== selectedWorker.resource_id ||
        (current.generation ?? null) !== selectedWorker.generation)
    )
      throw new ResourcePolicyError({
        message: `Worker identity changed for ${selectedWorker.name}`,
      })
  }
  const selectedWorkers = new Set(
    selected.filter((item) => item.kind === "worker").map((item) => item.name)
  )
  for (const queue of await listCloudflareResources(
    credentials,
    "queue",
    request
  )) {
    const response = await cloudflareResourceRequest(
      credentials,
      `queues/${encodeURIComponent(queue.id)}/consumers`,
      request
    )
    const consumers = Schema.decodeUnknownSync(CloudflareQueueConsumers)(
      response.result
    )
    for (const consumer of consumers) {
      if (
        selected.some(
          (item) => item.kind === "queue" && item.resource_id === queue.id
        ) ||
        selectedWorkers.has(consumer.script ?? consumer.script_name ?? "")
      )
        throw new ResourcePolicyError({
          message: `Queue ${queue.name} has consumer ${consumer.consumer_id}; detach it through the owning Alchemy stack before this resource action`,
        })
    }
  }
  for (const worker of workers) {
    const settings = await readWorkerSettings(credentials, worker.name, request)
    for (const binding of settings.bindings) {
      if (
        binding.name === "SYLPH_RECOVERY_CONTROL" &&
        selected.some((item) =>
          bindingReferencesResource(binding, item, worker.name)
        )
      )
        throw new ResourcePolicyError({
          message:
            "The selection includes recovery control state; record its independent purpose and exclude it from application cleanup",
        })
    }
    if (selectedWorkers.has(worker.name)) {
      if (settings.containers?.length || settings.tail_consumers?.length)
        throw new ResourcePolicyError({
          message: `Worker ${worker.name} has Containers or tail consumers outside supported removal`,
        })
      continue
    }
    for (const tail of settings.tail_consumers ?? [])
      if (selectedWorkers.has(tail.service))
        throw new ResourcePolicyError({
          message: `Worker ${worker.name} still references tail consumer ${tail.service}; detach it first`,
        })
    for (const binding of settings.bindings) {
      const referenced = selected.find((item) =>
        bindingReferencesResource(binding, item, worker.name)
      )
      if (referenced)
        throw new ResourcePolicyError({
          message: `${referenced.name} is still referenced by Worker ${worker.name} (${binding.name}); deploy removal of that binding first`,
        })
    }
  }
  for (const kind of ["durable_object", "workflow", "domain"] as const) {
    for (const live of await listCloudflareResources(
      credentials,
      kind,
      request
    )) {
      if (
        live.service &&
        selectedWorkers.has(live.service) &&
        !selected.some(
          (item) => item.kind === kind && item.resource_id === live.id
        )
      )
        throw new ResourcePolicyError({
          message: `Worker ${live.service} still owns ${kind} ${live.name}; include its verified claim before retiring the Worker`,
        })
      if (
        kind === "durable_object" &&
        selected.some(
          (item) => item.kind === kind && item.resource_id === live.id
        ) &&
        !selectedWorkers.has(live.service ?? "")
      )
        throw new ResourcePolicyError({
          message: `Durable Object ${live.name} must be removed with its host Worker; standalone class deletion needs a reviewed Alchemy migration`,
        })
    }
  }
}

export const removeOwnedResources = async (
  database: ResourceDatabase,
  credentials: ResourceCredentials,
  owner: ResourceOwner,
  resources: ReadonlyArray<StoredProjectResource>,
  request: ResourceRequest = fetch
) => {
  await verifyRemovalReferences(credentials, resources, request)
  for (const resource of resources) {
    if (resource.state === "deleted") continue
    const existing = await findResource(credentials, resource, request)
    if (
      existing &&
      (!resource.resource_id ||
        existing.id !== resource.resource_id ||
        (existing.generation ?? null) !== resource.generation)
    )
      throw new ResourcePolicyError({
        message: `Resource ownership changed for ${resource.name}`,
      })
  }
  const priority = {
    domain: 0,
    workflow: 1,
    worker: 2,
    durable_object: 3,
    queue: 4,
    d1: 5,
    kv: 5,
    r2: 5,
  }
  const ordered = [...resources].sort(
    (a, b) => priority[a.kind] - priority[b.kind]
  )
  for (const resource of ordered) {
    if (resource.state === "deleted") continue
    const claim = await database
      .prepare(
        "SELECT * FROM project_resource WHERE account_id = ? AND kind = ? AND name = ?"
      )
      .bind(credentials.accountId, resource.kind, resource.name)
      .first<StoredProjectResource>()
    if (
      !claim ||
      claim.project_id !== owner.projectId ||
      claim.scope !== owner.scope ||
      claim.resource_id !== resource.resource_id ||
      claim.generation !== resource.generation ||
      claim.purpose === "recovery_control"
    )
      throw new ResourcePolicyError({
        message: `Resource claim changed for ${resource.name}`,
      })
    const existing = await findResource(credentials, resource, request)
    if (existing) {
      if (
        !resource.resource_id ||
        existing.id !== resource.resource_id ||
        (existing.generation ?? null) !== resource.generation
      )
        throw new ResourcePolicyError({
          message: `Resource ownership changed for ${resource.name}`,
        })
      if (resource.kind === "durable_object")
        throw new ResourcePolicyError({
          message: `Durable Object ${resource.name} still exists after deleting its host; keep its claim and inspect Cloudflare before retrying`,
        })
      await verifyRemovalReferences(
        credentials,
        ordered.filter((item) => item.state !== "deleted"),
        request
      )
      if (resource.kind === "r2")
        await emptyPreviewBucket(credentials, resource.name, request)
      const force =
        resource.kind === "worker" &&
        resources.some(
          (item) =>
            item.kind === "durable_object" &&
            item.name.startsWith(`${resource.name}/`)
        )
      const identity =
        resource.kind === "workflow" ? resource.name : existing.id
      try {
        await cloudflareResourceRequest(
          credentials,
          `${resourceCollectionPath(resource.kind)}/${encodeURIComponent(identity)}${force ? "?force=true" : ""}`,
          request,
          "DELETE"
        )
      } catch (cause) {
        if (await findResource(credentials, resource, request)) throw cause
      }
      if (await findResource(credentials, resource, request))
        throw new ResourcePolicyError({
          message: `Resource ${resource.name} still exists after removal`,
        })
    }
    await database
      .prepare(
        "UPDATE project_resource SET state = 'deleted' WHERE account_id = ? AND project_id = ? AND scope = ? AND kind = ? AND name = ?"
      )
      .bind(
        credentials.accountId,
        owner.projectId,
        owner.scope,
        resource.kind,
        resource.name
      )
      .run()
  }
}
