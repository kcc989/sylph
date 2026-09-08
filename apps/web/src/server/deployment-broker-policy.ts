import { Schema } from "effect"
import {
  BrokerBinding,
  BrokerJson,
  type BrokerResource,
} from "@workspace/domain/project-deployment-broker"
import type { ProjectResourcePlan } from "@workspace/domain/project-resources"

export function brokerDenied(reason: string): never {
  throw new Error(
    `Project deployment capability denied: ${reason}. Add a reviewed broker adapter; account credentials are never supplied to Project commands.`
  )
}

const object = Schema.decodeUnknownSync(BrokerJson)
const string = Schema.decodeUnknownSync(Schema.String)
const keys = (value: typeof BrokerJson.Type, allowed: readonly string[]) => {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    brokerDenied("unsupported request fields")
}

export const validateBrokerBindings = (
  value: (typeof BrokerJson.Type)["bindings"],
  plan: ProjectResourcePlan,
  resources: readonly BrokerResource[]
) => {
  for (const unknownBinding of Schema.decodeUnknownSync(
    Schema.Array(BrokerJson)
  )(value ?? [])) {
    const binding = Schema.decodeUnknownSync(BrokerBinding)(unknownBinding)
    const reference = (kind: string, field: string, physical = false) => {
      const target = string(unknownBinding[field])
      if (
        !resources.some(
          (resource) =>
            resource.kind === kind &&
            (physical ? resource.name : resource.id) === target
        )
      )
        brokerDenied(`foreign ${kind} binding`)
    }
    switch (binding.type) {
      case "plain_text":
      case "secret_text":
        keys(unknownBinding, ["name", "type", "text"])
        string(unknownBinding.text)
        break
      case "json":
        keys(unknownBinding, ["name", "type", "json"])
        break
      case "assets":
        keys(unknownBinding, ["name", "type"])
        break
      case "d1":
        if (
          resources.some(
            (resource) =>
              resource.kind === "d1" &&
              resource.id === unknownBinding.id &&
              resource.name.endsWith("-recovery-drill")
          )
        )
          brokerDenied("restore drill database cannot be bound to a Worker")
        keys(unknownBinding, ["name", "type", "id"])
        reference("d1", "id")
        break
      case "kv_namespace":
        keys(unknownBinding, ["name", "type", "namespace_id"])
        reference("kv", "namespace_id")
        break
      case "r2_bucket":
        keys(unknownBinding, ["name", "type", "bucket_name"])
        reference("r2", "bucket_name", true)
        break
      case "queue":
        keys(unknownBinding, ["name", "type", "queue_name"])
        reference("queue", "queue_name", true)
        break
      case "service":
        keys(unknownBinding, ["name", "type", "service", "entrypoint"])
        if (
          !plan.some(
            (resource) =>
              resource.kind === "worker" &&
              resource.name === unknownBinding.service
          )
        )
          brokerDenied("foreign service binding")
        break
      case "durable_object_namespace":
        keys(unknownBinding, ["name", "type", "class_name", "script_name"])
        if (
          !plan.some(
            (resource) =>
              resource.kind === "durable_object" &&
              resource.className === unknownBinding.class_name &&
              (!unknownBinding.script_name ||
                resource.worker === unknownBinding.script_name)
          )
        )
          brokerDenied("foreign Durable Object binding")
        break
      case "workflow":
        keys(unknownBinding, [
          "name",
          "type",
          "workflow_name",
          "class_name",
          "script_name",
        ])
        if (
          !plan.some(
            (resource) =>
              resource.kind === "workflow" &&
              resource.name === unknownBinding.workflow_name &&
              resource.worker === unknownBinding.script_name &&
              resource.className === unknownBinding.class_name
          )
        )
          brokerDenied("foreign Workflow binding")
        break
      case "ai":
        keys(unknownBinding, ["name", "type"])
        if (
          !plan.some((resource) =>
            resource.bindings?.some(
              (item) => item.type === "ai" && item.name === binding.name
            )
          )
        )
          brokerDenied("unreviewed AI binding")
        break
      default:
        brokerDenied(`unsupported binding ${binding.type}`)
    }
  }
}

export const validateWorkerMetadata = (
  value: typeof BrokerJson.Type,
  plan: ProjectResourcePlan,
  resources: readonly BrokerResource[]
) => {
  const metadata = object(value)
  keys(metadata, [
    "main_module",
    "body_part",
    "bindings",
    "compatibility_date",
    "compatibility_flags",
    "migrations",
    "observability",
    "limits",
    "placement",
    "tags",
    "assets",
    "keep_assets",
    "logpush",
    "tail_consumers",
  ])
  if (metadata.tail_consumers) brokerDenied("tail consumers")
  validateBrokerBindings(metadata.bindings, plan, resources)
  if (metadata.migrations) {
    const migrations = object(metadata.migrations)
    keys(migrations, ["old_tag", "new_tag", "steps"])
    for (const step of Schema.decodeUnknownSync(Schema.Array(BrokerJson))(
      migrations.steps ?? []
    )) {
      keys(step, [
        "new_classes",
        "new_sqlite_classes",
        "deleted_classes",
        "renamed_classes",
      ])
      for (const field of [
        "new_classes",
        "new_sqlite_classes",
        "deleted_classes",
      ]) {
        for (const className of Schema.decodeUnknownSync(
          Schema.Array(Schema.String)
        )(step[field] ?? []))
          if (
            !plan.some(
              (resource) =>
                resource.kind === "durable_object" &&
                resource.className === className
            )
          )
            brokerDenied("unreviewed Durable Object migration")
      }
      if (step.renamed_classes)
        brokerDenied("Durable Object rename requires dedicated review")
    }
  }
  return metadata
}

export interface BrokerAuthorization {
  kind: string
  collection?: boolean
  createName?: string
  worker?: boolean
  objectData?: boolean
}

export const authorizeBrokerRequest = (
  path: string,
  method: string,
  body: typeof BrokerJson.Type,
  plan: ProjectResourcePlan,
  resources: readonly BrokerResource[]
): BrokerAuthorization => {
  const objectKey = path.match(/^\/r2\/buckets\/[^/]+\/objects\/(.+)$/)?.[1]
  const checkedPath = objectKey
    ? path.slice(0, path.length - objectKey.length)
    : path
  if (/%|\\|\/\/|\.\./.test(checkedPath))
    brokerDenied("ambiguous resource path")
  if (objectKey)
    for (const segment of objectKey.split("/")) {
      const decoded = decodeURIComponent(segment)
      if (
        !decoded ||
        decoded === "." ||
        decoded === ".." ||
        /[\\/]/.test(decoded)
      )
        brokerDenied("ambiguous object key")
    }
  if (path === "/workers/subdomain" && method === "GET")
    return { kind: "account_subdomain" }
  if (path === "/workers/durable_objects/namespaces" && method === "GET")
    return { kind: "durable_object", collection: true }
  const families = [
    {
      prefix: "/d1/database",
      kind: "d1",
      create: ["name", "primary_location_hint", "jurisdiction"],
      name: "name",
      tails: [
        "",
        "query",
        "raw",
        "time_travel/bookmark",
        "time_travel/restore",
        "export",
        "import",
      ],
    },
    {
      prefix: "/storage/kv/namespaces",
      kind: "kv",
      create: ["title"],
      name: "title",
      tails: ["", "keys", "values", "bulk", "metadata"],
    },
    {
      prefix: "/r2/buckets",
      kind: "r2",
      create: ["name", "locationHint", "storageClass"],
      name: "name",
      tails: ["", "objects"],
    },
    {
      prefix: "/queues",
      kind: "queue",
      create: ["queue_name", "settings"],
      name: "queue_name",
      tails: ["", "consumers", "messages", "messages/pull", "messages/ack"],
    },
    {
      prefix: "/workflows",
      kind: "workflow",
      create: ["script_name", "class_name"],
      name: "",
      tails: ["", "instances"],
    },
    {
      prefix: "/workers/scripts",
      kind: "worker",
      create: [],
      name: "",
      tails: [
        "",
        "settings",
        "script-settings",
        "subdomain",
        "schedules",
        "assets-upload-session",
        "versions",
        "deployments",
        "secrets",
      ],
    },
  ]
  for (const family of families) {
    if (path !== family.prefix && !path.startsWith(`${family.prefix}/`))
      continue
    const remainder = path.slice(family.prefix.length + 1)
    if (!remainder) {
      if (method === "GET") return { kind: family.kind, collection: true }
      if (method !== "POST" || !family.name) brokerDenied("collection mutation")
      const input = object(body)
      keys(input, family.create)
      const name = string(input[family.name])
      if (
        !plan.some(
          (resource) => resource.kind === family.kind && resource.name === name
        )
      )
        brokerDenied("resource outside the frozen plan")
      return { kind: family.kind, createName: name }
    }
    const [id, ...parts] = remainder.split("/")
    const tail = parts.join("/")
    const planned = plan.find(
      (resource) => resource.kind === family.kind && resource.name === id
    )
    const owned = resources.find(
      (resource) =>
        resource.kind === family.kind &&
        (resource.id === id ||
          ((family.kind === "worker" ||
            family.kind === "r2" ||
            family.kind === "workflow") &&
            resource.name === id))
    )
    if (
      !owned &&
      !(
        family.kind === "worker" &&
        planned &&
        ((method === "PUT" && !tail) ||
          (method === "POST" && tail === "assets-upload-session"))
      ) &&
      !(family.kind === "workflow" && planned && method === "PUT" && !tail)
    )
      brokerDenied(
        "resource belongs to another Project or has no verified identity"
      )
    if (
      !family.tails.includes(tail) &&
      !(family.kind === "kv" && /^(values|metadata)\/[^/]+$/.test(tail)) &&
      !(family.kind === "r2" && /^objects\/.+/.test(tail)) &&
      !(family.kind === "queue" && /^consumers\/[^/]+$/.test(tail)) &&
      !(family.kind === "workflow" && /^instances\/[^/]+$/.test(tail))
    )
      brokerDenied("unsupported resource API")
    if (
      method === "DELETE" &&
      !(family.kind === "kv" && /^values\/[^/]+$/.test(tail)) &&
      !(family.kind === "r2" && /^objects\/.+/.test(tail))
    )
      brokerDenied("resource removal requires the platform removal workflow")
    if (family.kind === "worker") {
      if (
        (method === "PUT" && !tail) ||
        (["settings", "script-settings"].includes(tail) &&
          ["PATCH", "PUT"].includes(method))
      )
        validateWorkerMetadata(body, plan, resources)
      else if (method !== "GET") {
        if (tail === "subdomain" && method === "POST")
          keys(object(body), ["enabled", "previews_enabled"])
        else if (tail === "assets-upload-session" && method === "POST")
          keys(object(body), ["manifest"])
        else if (tail === "secrets" && method === "PUT") {
          keys(object(body), ["name", "text", "type"])
          if (object(body).type !== "secret_text")
            brokerDenied("unsupported secret type")
        } else brokerDenied("unsupported Worker mutation")
      }
    } else if (family.kind === "workflow" && method === "PUT") {
      const input = object(body)
      keys(input, family.create)
      if (
        !planned ||
        planned.worker !== input.script_name ||
        planned.className !== input.class_name
      )
        brokerDenied("foreign Workflow host")
    } else if (family.kind === "d1" && method !== "GET") {
      if (tail === "query" || tail === "raw")
        keys(object(body), ["sql", "params"])
      else if (tail === "time_travel/restore")
        keys(object(body), ["bookmark", "timestamp"])
      else brokerDenied("unsupported D1 mutation")
    }
    if (
      family.kind === "kv" &&
      method !== "GET" &&
      !(
        /^(values|metadata)\/[^/]+$/.test(tail) &&
        ["PUT", "DELETE"].includes(method)
      )
    )
      brokerDenied("unsupported KV mutation")
    if (
      family.kind === "r2" &&
      method !== "GET" &&
      !(/^objects\/.+/.test(tail) && ["PUT", "DELETE"].includes(method))
    )
      brokerDenied("unsupported R2 object operation")
    if (family.kind === "queue" && method !== "GET") {
      if (!tail && method === "PUT") {
        keys(body, ["queue_name", "settings"])
        if (body.queue_name && body.queue_name !== owned?.name)
          brokerDenied("queue rename changes the frozen plan")
        if (body.settings)
          keys(object(body.settings), [
            "delivery_delay",
            "delivery_paused",
            "message_retention_period",
          ])
      } else if (
        (tail === "consumers" && method === "POST") ||
        (/^consumers\/[^/]+$/.test(tail) && method === "PUT")
      ) {
        keys(body, ["script_name", "type", "dead_letter_queue", "settings"])
        if (
          body.type !== "worker" ||
          !plan.some(
            (item) => item.kind === "worker" && item.name === body.script_name
          )
        )
          brokerDenied("foreign Queue consumer")
        if (
          body.dead_letter_queue &&
          !resources.some(
            (item) =>
              item.kind === "queue" &&
              [item.id, item.name].includes(string(body.dead_letter_queue))
          )
        )
          brokerDenied("foreign dead-letter Queue")
        if (body.settings)
          keys(object(body.settings), [
            "batch_size",
            "max_concurrency",
            "max_retries",
            "max_wait_time_ms",
            "retry_delay",
          ])
      } else brokerDenied("unsupported Queue mutation")
    }
    return {
      kind: family.kind,
      createName: !owned && !tail ? id : undefined,
      worker: family.kind === "worker",
      objectData: family.kind === "r2" && /^objects\/.+/.test(tail),
    }
  }
  brokerDenied("API outside the approved deployment surface")
}

export const validateBrokerQuery = (
  path: string,
  method: string,
  query: URLSearchParams
) => {
  let allowed: string[] = []
  if (method === "GET") {
    if (path === "/d1/database") allowed = ["page", "per_page", "name"]
    else if (
      [
        "/storage/kv/namespaces",
        "/queues",
        "/workflows",
        "/workers/durable_objects/namespaces",
      ].includes(path)
    )
      allowed = ["page", "per_page"]
    else if (path === "/r2/buckets")
      allowed = ["per_page", "cursor", "name_contains", "direction"]
    else if (path === "/workers/scripts") allowed = ["include_subdomain"]
    else if (/^\/r2\/buckets\/[^/]+\/objects$/.test(path))
      allowed = ["per_page", "cursor", "prefix", "delimiter", "start_after"]
    else if (/^\/storage\/kv\/namespaces\/[^/]+\/keys$/.test(path))
      allowed = ["limit", "cursor", "prefix"]
    else if (/^\/workflows\/[^/]+\/instances$/.test(path))
      allowed = ["page", "per_page", "status"]
    else if (/^\/d1\/database\/[^/]+\/time_travel\/bookmark$/.test(path))
      allowed = ["timestamp"]
  }
  if (
    method === "POST" &&
    /^\/d1\/database\/[^/]+\/time_travel\/restore$/.test(path)
  )
    allowed = ["bookmark", "timestamp"]
  if (
    method === "PUT" &&
    /^\/storage\/kv\/namespaces\/[^/]+\/values\/[^/]+$/.test(path)
  )
    allowed = ["expiration", "expiration_ttl"]
  const names = [...query.keys()]
  if (
    new Set(names).size !== names.length ||
    names.some((name) => !allowed.includes(name))
  )
    brokerDenied("unapproved or duplicate query field")
}
