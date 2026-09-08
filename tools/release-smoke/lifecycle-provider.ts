import {
  TelemetryResponse,
  type TelemetryQuery,
} from "@workspace/domain/project-operations"
import { Schema } from "effect"
import { RecoveryQueryResponse } from "@workspace/domain/cloudflare-recovery"
import {
  LifecycleWorkflowResponse,
  LifecycleR2Listing,
  type LifecycleProviderEvidence,
} from "@workspace/domain/lifecycle-actions"
import { listCloudflareResources } from "../../apps/web/src/server/cloudflare-resources"
import {
  CloudflareWorkerBindings,
  type StoredProjectResource,
} from "@workspace/domain/project-resources"
import { jsonPointer, requireLifecycleProbe } from "./lifecycle"

export class LifecycleProvider {
  readonly requests: Array<LifecycleProviderEvidence["requests"][number]> = []
  constructor(
    private readonly accountId: string,
    private readonly token: string,
    private readonly request: typeof fetch = fetch
  ) {}

  async read(path: string, select?: string, params?: readonly Schema.Json[]) {
    requireLifecycleProbe({
      path,
      select,
      assertions: [{ pointer: "/success", equals: true }],
    })
    const response = await this.request(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/${path}`,
      {
        method: select ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: select
          ? JSON.stringify({ sql: select, params: params ?? [] })
          : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      }
    )
    const body = Schema.decodeUnknownSync(Schema.Json)(await response.json())
    this.requests.push({ path, select, params, status: response.status, body })
    if (!response.ok || jsonPointer(body, "/success") !== true)
      throw new Error(
        `Cloudflare read failed: ${path} (HTTP ${response.status})`
      )
    return body
  }

  async telemetry(query: TelemetryQuery) {
    const path = "workers/observability/telemetry/query"
    const response = await this.request(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/${path}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(query),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      }
    )
    const body = Schema.decodeUnknownSync(Schema.Json)(await response.json())
    this.requests.push({ path, status: response.status, body })
    if (!response.ok || jsonPointer(body, "/success") !== true)
      throw new Error("Cloudflare telemetry read failed")
    return Schema.decodeUnknownSync(TelemetryResponse)(
      jsonPointer(body, "/result")
    )
  }

  async object(bucket: string, key: string) {
    if (
      !/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket) ||
      !/^[a-zA-Z0-9_.-]+$/.test(key)
    )
      throw new Error("Use an exact R2 fixture bucket and simple object key")
    const base = `r2/buckets/${bucket}/objects`
    const get = async (path: string) => {
      const response = await this.request(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/${path}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${this.token}` },
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        }
      )
      if (!response.ok)
        throw new Error(`R2 object read failed (HTTP ${response.status})`)
      return response
    }
    const response = await get(`${base}/${key}`)
    const body = await response.text()
    this.requests.push({
      path: `${base}/${key}`,
      status: response.status,
      body: { body, headers: Object.fromEntries(response.headers) },
    })
    let cursor: string | undefined
    const seen = new Set<string>()
    do {
      const path = `${base}?prefix=${key}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
      const page = await get(path)
      const raw = Schema.decodeUnknownSync(Schema.Json)(await page.json())
      this.requests.push({ path, status: page.status, body: raw })
      const listing = Schema.decodeUnknownSync(LifecycleR2Listing)(raw)
      const object = listing.result.find((item) => item.key === key)
      if (object)
        return {
          body,
          customMetadata: object.custom_metadata ?? {},
          httpMetadata: object.http_metadata ?? {},
        }
      if (!listing.result_info?.is_truncated) break
      cursor = listing.result_info.cursor
      if (!cursor || seen.has(cursor))
        throw new Error("R2 listing has an invalid pagination cursor")
      seen.add(cursor)
    } while (cursor)
    throw new Error("R2 fixture missing from provider listing")
  }

  async rows<S extends Schema.Top & { readonly DecodingServices: never }>(
    databaseId: string,
    sql: string,
    schema: S,
    params: readonly Schema.Json[] = []
  ) {
    const response = Schema.decodeUnknownSync(RecoveryQueryResponse)(
      await this.read(`d1/database/${databaseId}/query`, sql, params)
    )
    const result = response.result[0]
    if (!response.success || !result?.success || response.result.length !== 1)
      throw new Error("Expected one D1 query result")
    return Schema.decodeUnknownSync(Schema.Array(schema))(result.results)
  }

  async settings(worker: string) {
    return Schema.decodeUnknownSync(CloudflareWorkerBindings)(
      jsonPointer(
        await this.read(`workers/scripts/${worker}/settings`),
        "/result"
      )
    )
  }

  async workflow(name: string, id: string) {
    return Schema.decodeUnknownSync(LifecycleWorkflowResponse)(
      await this.read(`workflows/${name}/instances/${id}`)
    ).result.status
  }

  async assertResourceStates(
    resources: readonly StoredProjectResource[],
    absent: boolean
  ) {
    const credentials = { accountId: this.accountId, token: this.token }
    for (const kind of new Set(resources.map((item) => item.kind))) {
      const observed = await listCloudflareResources(
        credentials,
        kind,
        async (input, init) => {
          if (init?.method !== "GET")
            throw new Error("Resource observation only permits GET")
          const response = await this.request(input, {
            ...init,
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
          })
          const body = Schema.decodeUnknownSync(Schema.Json)(
            await response.clone().json()
          )
          const url = new URL(String(input))
          this.requests.push({
            path:
              url.pathname.split(`/accounts/${this.accountId}/`)[1] +
              url.search,
            status: response.status,
            body,
          })
          return response
        }
      )
      for (const resource of resources.filter((item) => item.kind === kind)) {
        const actual = observed.find(
          (item) =>
            item.id === resource.resource_id || item.name === resource.name
        )
        if (absent && actual)
          throw new Error(
            `Provider resource still exists: ${resource.kind}/${resource.name}`
          )
        if (
          !absent &&
          (!actual ||
            actual.id !== resource.resource_id ||
            (resource.generation !== null &&
              actual.generation !== resource.generation))
        )
          throw new Error(
            `Provider identity changed or is missing: ${resource.kind}/${resource.name}`
          )
      }
    }
  }
}
