import { Schema } from "effect"
import { RecoveryQueryResponse } from "@workspace/domain/cloudflare-recovery"
import {
  LifecycleWorkflowResponse,
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
