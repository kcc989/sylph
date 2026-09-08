import { Context, Effect, Layer, Schema } from "effect"
import {
  BrokerJson,
  BrokerPlan,
  BrokerResource,
  BrokerCollectionPage,
  DeploymentCapability,
  DeploymentBrokerFailure,
} from "@workspace/domain/project-deployment-broker"
import {
  authorizeBrokerRequest,
  validateBrokerQuery,
  brokerDenied,
} from "./deployment-broker-policy"

export interface DeploymentBrokerStore {
  capability: (hash: string) => Promise<DeploymentCapability | null>
  activePlan: (lease: DeploymentCapability) => Promise<string | null>
  resources: (lease: DeploymentCapability) => Promise<readonly BrokerResource[]>
  created: (
    lease: DeploymentCapability,
    resource: BrokerResource
  ) => Promise<void>
  state: (
    lease: DeploymentCapability,
    method: string,
    path: string,
    body: string
  ) => Promise<Response>
}

export class ProjectDeploymentBroker extends Context.Service<
  ProjectDeploymentBroker,
  {
    handle: (
      request: Request
    ) => Effect.Effect<Response, DeploymentBrokerFailure>
  }
>()("@sylph/ProjectDeploymentBroker") {}

export const capabilityHash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("")

export const ProjectDeploymentBrokerLive = (configuration: {
  store: DeploymentBrokerStore
  token: string
  fetch?: (url: string, options: RequestInit) => Promise<Response>
  now?: () => number
}) =>
  Layer.succeed(
    ProjectDeploymentBroker,
    ProjectDeploymentBroker.of({
      handle: Effect.fn("ProjectDeploymentBroker.handle")(function* (request) {
        return yield* Effect.tryPromise({
          try: async () => {
            const token = request.headers
              .get("Authorization")
              ?.match(/^Bearer (sylph-cap-[a-f0-9]{64})$/)?.[1]
            if (!token) brokerDenied("missing deployment capability")
            const lease = await configuration.store.capability(
              await capabilityHash(token)
            )
            if (
              !lease ||
              lease.revoked ||
              lease.expiresAt <= (configuration.now ?? Date.now)()
            )
              brokerDenied("expired or revoked deployment capability")
            if (
              (await configuration.store.activePlan(lease)) !== lease.planJson
            )
              brokerDenied("operation ended or reserved plan changed")
            const url = new URL(request.url)
            const prefix = "/api/project-deployment"
            if (!url.pathname.startsWith(`${prefix}/`))
              brokerDenied("incorrect broker route")
            const path = url.pathname.slice(prefix.length)
            if (
              Number(request.headers.get("Content-Length") ?? "0") >
              64 * 1024 * 1024
            )
              brokerDenied("request exceeds upload limit")
            if (path === "/version" && request.method === "GET")
              return Response.json({ version: 5 })
            if (path.startsWith("/state/"))
              return configuration.store.state(
                lease,
                request.method,
                `${path}${url.search}`,
                await request.text()
              )
            const accountPrefix = `/accounts/${lease.accountId}`
            if (!path.startsWith(`${accountPrefix}/`))
              brokerDenied("foreign account")
            const relative = path.slice(accountPrefix.length)
            validateBrokerQuery(relative, request.method, url.searchParams)
            const plan = Schema.decodeUnknownSync(BrokerPlan)(
              JSON.parse(lease.planJson)
            )
            const resources = (
              await configuration.store.resources(lease)
            ).filter((resource) =>
              plan.some(
                (item) =>
                  item.kind === resource.kind && item.name === resource.name
              )
            )
            const bytes = await request.arrayBuffer()
            if (bytes.byteLength > 64 * 1024 * 1024)
              brokerDenied("request exceeds upload limit")
            const contentType = request.headers.get("Content-Type") ?? ""
            let parsed: typeof BrokerJson.Type = {}
            const objectData = /^\/r2\/buckets\/[^/]+\/objects\/.+/.test(
              relative
            )
            if (bytes.byteLength && !objectData) {
              if (contentType.startsWith("multipart/form-data")) {
                const form = await new Response(bytes, {
                  headers: { "Content-Type": contentType },
                }).formData()
                if (form.getAll("metadata").length !== 1)
                  brokerDenied("duplicate or missing Worker metadata")
                const metadata = form.get("metadata")
                const json = Schema.is(Schema.String)(metadata)
                  ? metadata
                  : metadata instanceof Blob
                    ? await metadata.text()
                    : ""
                parsed = Schema.decodeUnknownSync(BrokerJson)(JSON.parse(json))
              } else if (contentType.includes("application/json"))
                parsed = Schema.decodeUnknownSync(BrokerJson)(
                  JSON.parse(new TextDecoder().decode(bytes))
                )
              else if (!relative.includes("/values/"))
                brokerDenied("unsupported request encoding")
            }
            if (
              request.method === "GET" &&
              /^\/workers\/scripts\/[^/]+(?:\/(?:settings|script-settings))?$/.test(
                relative
              )
            ) {
              const name = relative.split("/")[3]
              if (
                plan.some(
                  (item) => item.kind === "worker" && item.name === name
                ) &&
                !resources.some(
                  (item) => item.kind === "worker" && item.name === name
                )
              )
                return Response.json(
                  {
                    success: false,
                    errors: [
                      {
                        code: 10007,
                        message: "Reserved Worker is not created yet",
                      },
                    ],
                  },
                  { status: 404 }
                )
            }
            const authorization = authorizeBrokerRequest(
              relative,
              request.method,
              parsed,
              plan,
              resources
            )
            const headers = new Headers({
              Authorization: `Bearer ${configuration.token}`,
            })
            if (contentType) headers.set("Content-Type", contentType)
            if (objectData)
              for (const [name, value] of request.headers) {
                if (
                  [
                    "cache-control",
                    "content-disposition",
                    "content-encoding",
                    "content-language",
                    "expires",
                    "cf-r2-custom-metadata",
                    "cf-r2-http-metadata",
                  ].includes(name) ||
                  name.startsWith("x-amz-meta-")
                )
                  headers.set(name, value)
              }
            const fetcher = configuration.fetch ?? fetch
            const upstreamUrl = new URL(
              `https://api.cloudflare.com/client/v4${path}${url.search}`
            )
            if (authorization.collection && authorization.kind !== "worker") {
              upstreamUrl.searchParams.delete("cursor")
              upstreamUrl.searchParams.set("page", "1")
              upstreamUrl.searchParams.set(
                "per_page",
                authorization.kind === "r2" ? "1000" : "100"
              )
            }
            if (
              ["worker", "workflow"].includes(authorization.kind) &&
              !resources.some(
                (resource) =>
                  resource.kind === authorization.kind &&
                  resource.name ===
                    relative.split("/")[authorization.kind === "worker" ? 3 : 2]
              ) &&
              request.method !== "GET"
            ) {
              const probe =
                authorization.kind === "worker"
                  ? `${upstreamUrl.origin}${upstreamUrl.pathname.split("/assets-upload-session")[0]}/settings`
                  : `${upstreamUrl.origin}${upstreamUrl.pathname}`
              const existing = await fetcher(probe, {
                method: "GET",
                headers,
                redirect: "error",
                signal: AbortSignal.timeout(60000),
              })
              if (existing.status !== 404)
                brokerDenied(
                  "reserved resource already exists or its absence is unverified"
                )
            }
            const upstream = await fetcher(upstreamUrl.href, {
              method: request.method,
              headers,
              body: bytes.byteLength ? bytes : undefined,
              redirect: "error",
              signal: AbortSignal.timeout(60_000),
            })
            if (!upstream.ok)
              return Response.json(
                {
                  success: false,
                  errors: [
                    {
                      code: upstream.status,
                      message:
                        "The approved Cloudflare operation failed; provider error bodies are withheld.",
                    },
                  ],
                },
                { status: upstream.status }
              )
            const responseType = upstream.headers.get("Content-Type") ?? ""
            if (authorization.objectData && request.method === "GET") {
              const responseHeaders = new Headers()
              for (const [name, value] of upstream.headers)
                if (
                  [
                    "content-type",
                    "cache-control",
                    "content-disposition",
                    "content-encoding",
                    "content-language",
                    "expires",
                    "etag",
                    "last-modified",
                    "cf-r2-custom-metadata",
                    "cf-r2-http-metadata",
                  ].includes(name) ||
                  name.startsWith("x-amz-meta-")
                )
                  responseHeaders.set(name, value)
              return new Response(upstream.body, {
                status: upstream.status,
                headers: responseHeaders,
              })
            }
            if (!responseType.includes("application/json"))
              return new Response(upstream.body, {
                status: upstream.status,
                headers: { "Content-Type": responseType },
              })
            const result = Schema.decodeUnknownSync(BrokerJson)(
              await upstream.json()
            )
            if (authorization.kind === "account_subdomain") {
              const value = Schema.decodeUnknownSync(BrokerJson)(result.result)
              return Response.json({
                success: true,
                result: {
                  subdomain: Schema.decodeUnknownSync(Schema.String)(
                    value.subdomain
                  ),
                },
              })
            }
            if (authorization.collection) {
              const wrappedBuckets =
                authorization.kind === "r2" &&
                !Schema.is(Schema.Array(BrokerJson))(result.result)
              const values = [
                ...Schema.decodeUnknownSync(Schema.Array(BrokerJson))(
                  wrappedBuckets
                    ? Schema.decodeUnknownSync(BrokerJson)(result.result)
                        .buckets
                    : result.result
                ),
              ]
              let pageResult = result
              let pageLength = values.length
              const cursors = new Set<string>()
              for (let page = 1; authorization.kind !== "worker"; page++) {
                const info = Schema.decodeUnknownSync(BrokerCollectionPage)(
                  pageResult.result_info ?? {}
                )
                if (authorization.kind === "r2") {
                  if (!info.cursor) break
                  if (cursors.has(info.cursor))
                    brokerDenied("repeated provider collection cursor")
                  cursors.add(info.cursor)
                  upstreamUrl.searchParams.set("cursor", info.cursor)
                } else {
                  if (
                    info.total_pages !== undefined
                      ? page >= info.total_pages
                      : pageLength < 100
                  )
                    break
                  upstreamUrl.searchParams.set("page", String(page + 1))
                }
                if (page >= 1000)
                  brokerDenied("provider collection is incomplete")
                const next = await fetcher(upstreamUrl.href, {
                  method: "GET",
                  headers,
                  redirect: "error",
                  signal: AbortSignal.timeout(60000),
                })
                if (!next.ok) brokerDenied("provider collection is unavailable")
                pageResult = Schema.decodeUnknownSync(BrokerJson)(
                  await next.json()
                )
                if (pageResult.success !== true)
                  brokerDenied("provider collection failed")
                const items = Schema.decodeUnknownSync(
                  Schema.Array(BrokerJson)
                )(
                  wrappedBuckets
                    ? Schema.decodeUnknownSync(BrokerJson)(pageResult.result)
                        .buckets
                    : pageResult.result
                )
                values.push(...items)
                pageLength = items.length
              }
              const allowed = values.filter((value) => {
                if (authorization.kind === "durable_object")
                  return plan.some(
                    (item) =>
                      item.kind === "durable_object" &&
                      item.worker === value.script &&
                      item.className === value.class
                  )
                return resources.some(
                  (resource) =>
                    resource.kind === authorization.kind &&
                    [value.id, value.uuid, value.queue_id, value.name].includes(
                      resource.id
                    )
                )
              })
              return Response.json({
                success: true,
                result: wrappedBuckets ? { buckets: allowed } : allowed,
                result_info: {
                  page: 1,
                  per_page: allowed.length,
                  count: allowed.length,
                  total_count: allowed.length,
                },
              })
            }
            if (authorization.createName && result.success === true) {
              const value = Schema.decodeUnknownSync(BrokerJson)(result.result)
              const id =
                authorization.kind === "worker"
                  ? authorization.createName
                  : Schema.decodeUnknownSync(Schema.String)(
                      value.uuid ?? value.id ?? value.queue_id ?? value.name
                    )
              await configuration.store.created(lease, {
                kind: authorization.kind,
                name: authorization.createName,
                id,
              })
            }
            return Response.json(result)
          },
          catch: () =>
            new DeploymentBrokerFailure({
              message:
                "Project deployment capability denied or provider request failed. The operation is outside the approved surface, expired, or revoked; no account credential is available to Project commands.",
            }),
        })
      }),
    })
  )
