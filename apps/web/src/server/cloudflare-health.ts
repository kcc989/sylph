import { Schema } from "effect"
import { CloudflareResourceResponse } from "@workspace/domain/project-resources"
import {
  CloudflareDeployments,
  DeploymentIdentities,
  HealthObservation,
  OperationsFailure,
  TelemetryResponse,
  type TelemetryQuery,
  type DeploymentIdentity,
} from "@workspace/domain/project-operations"

export interface HealthCredentials {
  accountId: string
  token: string
}
const api = async (
  credentials: HealthCredentials,
  path: string,
  body?: TelemetryQuery,
  request: typeof fetch = fetch
) => {
  const response = await request(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(credentials.accountId)}/${path}`,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    }
  )
  if (!response.ok)
    throw new OperationsFailure({
      message: `Cloudflare health request failed (${response.status}). Check Workers Scripts Read and Workers Observability Write permissions.`,
    })
  if (!response.body)
    throw new OperationsFailure({
      message: "Cloudflare health returned an empty response",
    })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  let bytes = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 2_000_000)
        throw new OperationsFailure({
          message: "Cloudflare health response exceeded the collection limit",
        })
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    await reader.cancel()
  }
  const envelope = Schema.decodeUnknownSync(CloudflareResourceResponse)(
    JSON.parse(text)
  )
  if (!envelope.success)
    throw new OperationsFailure({
      message: "Cloudflare could not complete the health request",
    })
  return envelope.result
}

export const readDeploymentIdentity = async (
  credentials: HealthCredentials,
  scriptName: string,
  request: typeof fetch = fetch
): Promise<DeploymentIdentity> => {
  const result = Schema.decodeUnknownSync(CloudflareDeployments)(
    await api(
      credentials,
      `workers/scripts/${encodeURIComponent(scriptName)}/deployments`,
      undefined,
      request
    )
  )
  const active = result.deployments[0]
  const version = active?.versions[0]
  if (!active || active.versions.length !== 1 || version?.percentage !== 100)
    throw new OperationsFailure({
      message: "Health requires one Worker version serving all traffic",
    })
  return {
    accountId: credentials.accountId,
    scriptName,
    deploymentId: active.id,
    versionId: version.version_id,
  }
}

export const captureDeploymentIdentity = async (
  db: D1Database,
  credentials: HealthCredentials,
  projectId: string,
  deploymentId: string
) => {
  const resources = await db
    .prepare(
      "SELECT name FROM project_resource WHERE account_id = ? AND project_id = ? AND scope = 'production' AND kind = 'worker' AND state = 'active' ORDER BY name LIMIT 5"
    )
    .bind(credentials.accountId, projectId)
    .all<{ name: string }>()
  if (!resources.results.length || resources.results.length > 4)
    throw new OperationsFailure({
      message: "Health supports one to four owned production Workers",
    })
  const identities: DeploymentIdentity[] = []
  for (const resource of resources.results)
    identities.push(await readDeploymentIdentity(credentials, resource.name))
  await db
    .prepare(
      "UPDATE deployment SET identity_json = ? WHERE id = ? AND project_id = ? AND status = 'running'"
    )
    .bind(JSON.stringify(identities), deploymentId, projectId)
    .run()
}

export const collectHealth = async (
  credentials: HealthCredentials,
  target: { id: string; commit: string; identity_json: string | null },
  now: number,
  request: typeof fetch = fetch
): Promise<HealthObservation> => {
  const to = Math.floor((now - 60_000) / 60_000) * 60_000
  const from = to - 15 * 60_000
  const base = {
    deploymentId: target.id,
    commit: target.commit,
    checkedAt: now,
    from,
    to,
    requests: 0,
    errors: 0,
    p95Ms: null,
    limited: false,
    evidence: [],
  }
  try {
    if (!target.identity_json)
      throw new OperationsFailure({
        message:
          "Deployment identity was not captured. Collect health after the next verified release.",
      })
    const identities = Schema.decodeUnknownSync(DeploymentIdentities)(
      JSON.parse(target.identity_json)
    )
    if (!identities.length || identities.length > 4)
      throw new OperationsFailure({
        message: "Production Worker inventory is unavailable",
      })
    const evidence: HealthObservation["evidence"][number][] = []
    let limited = false
    let incomplete = false
    for (const identity of identities) {
      if (identity.accountId !== credentials.accountId)
        throw new OperationsFailure({
          message: "Deployment account does not match this installation",
        })
      const before = await readDeploymentIdentity(
        credentials,
        identity.scriptName,
        request
      )
      if (
        before.deploymentId !== identity.deploymentId ||
        before.versionId !== identity.versionId
      )
        throw new OperationsFailure({
          message:
            "Production has changed outside this Deployment. Verify the current release before collecting health.",
        })
      const result = Schema.decodeUnknownSync(TelemetryResponse)(
        await api(
          credentials,
          "workers/observability/telemetry/query",
          {
            queryId: crypto.randomUUID(),
            timeframe: { from, to },
            limit: 100,
            dry: true,
            view: "events",
            parameters: {
              filters: [
                {
                  key: "$workers.scriptName",
                  operation: "eq",
                  type: "string",
                  value: identity.scriptName,
                },
                {
                  key: "$workers.scriptVersion.id",
                  operation: "eq",
                  type: "string",
                  value: identity.versionId,
                },
                {
                  key: "$metadata.type",
                  operation: "eq",
                  type: "string",
                  value: "cf-worker-event",
                },
              ],
            },
          },
          request
        )
      )
      if (result.run.status !== "COMPLETED")
        throw new OperationsFailure({
          message:
            "Cloudflare telemetry is still processing. Try collection again.",
        })
      const events = result.events?.events ?? []
      limited ||= events.length >= 100
      const seen = new Set<string>()
      const previousCount = evidence.length
      for (const event of events.slice(0, 100)) {
        const worker = event.$workers
        if (
          !worker ||
          worker.scriptName !== identity.scriptName ||
          worker.scriptVersion?.id !== identity.versionId ||
          event.$metadata.type !== "cf-worker-event" ||
          event.timestamp < from ||
          event.timestamp >= to ||
          seen.has(worker.requestId)
        )
          continue
        seen.add(worker.requestId)
        evidence.push({
          requestId: worker.requestId.slice(0, 128),
          versionId: identity.versionId,
          scriptName: identity.scriptName,
          timestamp: event.timestamp,
          outcome: worker.outcome?.slice(0, 80) ?? "unknown",
          statusCode: event.$metadata.statusCode ?? null,
          wallTimeMs: worker.wallTimeMs ?? null,
        })
      }
      incomplete ||= evidence.length === previousCount
      const after = await readDeploymentIdentity(
        credentials,
        identity.scriptName,
        request
      )
      if (after.deploymentId !== identity.deploymentId)
        throw new OperationsFailure({
          message:
            "Production changed during collection. Collect again after verification.",
        })
    }
    const times = evidence
      .flatMap((event) => (event.wallTimeMs === null ? [] : [event.wallTimeMs]))
      .sort((a, b) => a - b)
    const p95Ms = times.length
      ? times[Math.ceil(times.length * 0.95) - 1]
      : null
    const errors = evidence.filter(
      (event) =>
        (event.statusCode ?? 0) >= 500 ||
        !["ok", "unknown"].includes(event.outcome)
    ).length
    return Schema.decodeUnknownSync(HealthObservation)({
      ...base,
      requests: evidence.length,
      errors,
      p95Ms,
      limited,
      evidence,
      status:
        errors || (p95Ms ?? 0) >= 2000
          ? "degraded"
          : evidence.length && !incomplete
            ? "observed"
            : "unknown",
      detail: incomplete
        ? "Some Worker versions have no matching invocation logs. Check Workers Logs and production traffic."
        : evidence.length
          ? "Sampled invocations from the recorded Worker versions. This is not an uptime guarantee."
          : "No matching invocation logs. Check that Workers Logs are enabled and traffic reached this version.",
    })
  } catch (cause) {
    return Schema.decodeUnknownSync(HealthObservation)({
      ...base,
      status: "unknown",
      detail:
        cause instanceof OperationsFailure
          ? cause.message
          : "Health collection failed. Check Cloudflare telemetry configuration and try again.",
    })
  }
}
