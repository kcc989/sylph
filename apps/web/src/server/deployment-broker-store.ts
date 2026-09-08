import { namespaceRecoveryBlockers } from "./resource-retirement"
import { Schema } from "effect"
import {
  BrokerJson,
  BrokerResource,
  DeploymentCapability,
} from "@workspace/domain/project-deployment-broker"
import type { DeploymentBrokerStore } from "./deployment-broker"
import { capabilityHash } from "./deployment-broker"
import { brokerDenied } from "./deployment-broker-policy"

interface BrokerStatement {
  bind(...values: Array<string | number | null>): BrokerStatement
  first<T = typeof BrokerJson.Type>(): Promise<T | null>
  all<T = typeof BrokerJson.Type>(): Promise<{ results: T[] }>
  run(): Promise<{ success?: boolean }>
}
export interface BrokerDatabase {
  prepare(sql: string): BrokerStatement
}

export const createDeploymentCapability = async (
  database: BrokerDatabase,
  accountId: string,
  owner: { projectId: string; scope: string; runId: string }
) => {
  const operation = await database
    .prepare(
      "SELECT plan_json FROM project_resource_operation WHERE account_id = ? AND project_id = ? AND scope = ? AND run_id = ? AND status = 'deploying'"
    )
    .bind(accountId, owner.projectId, owner.scope, owner.runId)
    .first<{ plan_json: string }>()
  if (!operation) brokerDenied("no active reserved resource operation")
  await database
    .prepare(
      "UPDATE project_deployment_capability SET revoked = 1 WHERE account_id = ? AND project_id = ? AND scope = ?"
    )
    .bind(accountId, owner.projectId, owner.scope)
    .run()
  const token = `sylph-cap-${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
  const id = crypto.randomUUID()
  await database
    .prepare(
      "INSERT INTO project_deployment_capability (id, token_hash, project_id, account_id, scope, run_id, plan_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      id,
      await capabilityHash(token),
      owner.projectId,
      accountId,
      owner.scope,
      owner.runId,
      operation.plan_json,
      Date.now() + 15 * 60_000
    )
    .run()
  return { id, token }
}

export const revokeDeploymentCapability = (
  database: BrokerDatabase,
  id: string
) =>
  database
    .prepare(
      "UPDATE project_deployment_capability SET revoked = 1 WHERE id = ?"
    )
    .bind(id)
    .run()

export const deploymentBrokerStore = (
  database: BrokerDatabase
): DeploymentBrokerStore => ({
  capability: async (hash) => {
    const row = await database
      .prepare(
        "SELECT id, project_id AS projectId, account_id AS accountId, scope, run_id AS runId, plan_json AS planJson, expires_at AS expiresAt, revoked FROM project_deployment_capability WHERE token_hash = ?"
      )
      .bind(hash)
      .first()
    return row
      ? Schema.decodeUnknownSync(DeploymentCapability)({
          ...row,
          revoked: row.revoked === 1,
        })
      : null
  },
  activePlan: async (lease) =>
    (
      await database
        .prepare(
          "SELECT plan_json FROM project_resource_operation WHERE account_id = ? AND project_id = ? AND scope = ? AND run_id = ? AND status = 'deploying'"
        )
        .bind(lease.accountId, lease.projectId, lease.scope, lease.runId)
        .first<{ plan_json: string }>()
    )?.plan_json ?? null,
  resources: async (lease) => {
    const result = await database
      .prepare(
        "SELECT kind, name, resource_id AS id FROM project_resource WHERE account_id = ? AND project_id = ? AND scope = ? AND resource_id IS NOT NULL AND state = 'active' UNION SELECT kind, name, resource_id AS id FROM project_deployment_resource WHERE account_id = ? AND project_id = ? AND scope = ?"
      )
      .bind(
        lease.accountId,
        lease.projectId,
        lease.scope,
        lease.accountId,
        lease.projectId,
        lease.scope
      )
      .all()
    return Schema.decodeUnknownSync(Schema.Array(BrokerResource))(
      result.results
    )
  },
  retirementAllowed: async (lease, namespaceId) =>
    (await namespaceRecoveryBlockers(database, lease.projectId, [namespaceId]))
      .length === 0,
  created: async (lease, resource) => {
    await database
      .prepare(
        "INSERT INTO project_deployment_resource (project_id, account_id, scope, kind, name, resource_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET resource_id = excluded.resource_id"
      )
      .bind(
        lease.projectId,
        lease.accountId,
        lease.scope,
        resource.kind,
        resource.name,
        resource.id
      )
      .run()
  },
  state: async (lease, method, path, body) => {
    const url = new URL(path, "https://state.invalid")
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent)
    if (parts.length === 7 && parts[5] === "resources")
      parts[6] = decodeURIComponent(parts[6] ?? "")
    const queryNames = [...url.searchParams.keys()]
    if (
      queryNames.length &&
      !(
        method === "DELETE" &&
        parts.length === 3 &&
        queryNames.length === 1 &&
        queryNames[0] === "stage"
      )
    )
      brokerDenied("unapproved Alchemy state query")
    const stack = parts[2]
    if (parts[0] !== "state" || parts[1] !== "stacks")
      brokerDenied("invalid Alchemy state path")
    const stackPrefix = `sylph-`
    if (stack && !stack.startsWith(stackPrefix))
      brokerDenied("invalid Project state stack")
    const key = parts.slice(2).map(encodeURIComponent).join("/")
    if (method === "GET") {
      if (
        parts.length === 2 ||
        parts.length === 4 ||
        (parts.length === 6 && parts[5] === "resources")
      ) {
        const values = await database
          .prepare(
            "SELECT state_key FROM project_deployment_state WHERE project_id = ? AND scope = ?"
          )
          .bind(lease.projectId, lease.scope)
          .all<{ state_key: string }>()
        const index = parts.length === 2 ? 0 : parts.length === 4 ? 2 : 4
        return Response.json([
          ...new Set(
            values.results
              .filter((row) => !key || row.state_key.startsWith(`${key}/`))
              .map((row) =>
                decodeURIComponent(row.state_key.split("/")[index] ?? "")
              )
              .filter(Boolean)
          ),
        ])
      }
      if (parts.length === 6 && parts.at(-1) === "replaced-resources") {
        const prefix = `${parts.slice(2, 5).map(encodeURIComponent).join("/")}/resources/`
        const rows = await database
          .prepare(
            "SELECT json FROM project_deployment_state WHERE project_id = ? AND scope = ? AND substr(state_key, 1, ?) = ?"
          )
          .bind(lease.projectId, lease.scope, prefix.length, prefix)
          .all<{ json: string }>()
        return Response.json(
          rows.results
            .map((row) =>
              Schema.decodeUnknownSync(BrokerJson)(JSON.parse(row.json))
            )
            .filter((state) => state.status === "replaced")
        )
      }
      const value = await database
        .prepare(
          "SELECT json FROM project_deployment_state WHERE project_id = ? AND scope = ? AND state_key = ?"
        )
        .bind(lease.projectId, lease.scope, key)
        .first<{ json: string }>()
      return value
        ? new Response(value.json, {
            headers: { "Content-Type": "application/json" },
          })
        : Response.json(null)
    }
    if (
      method === "PUT" &&
      ((parts.length === 7 && parts[5] === "resources") ||
        (parts.length === 6 && parts[5] === "output"))
    ) {
      JSON.parse(body)
      if (body.length > 5 * 1024 * 1024)
        brokerDenied("Alchemy state exceeds size limit")
      await database
        .prepare(
          "INSERT INTO project_deployment_state (project_id, scope, state_key, json) VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET json = excluded.json"
        )
        .bind(lease.projectId, lease.scope, key, body)
        .run()
      return new Response(body, {
        headers: { "Content-Type": "application/json" },
      })
    }
    if (method === "DELETE" && parts.length === 3) {
      const stage = url.searchParams.get("stage")
      const prefix = `${key}/${stage === null ? "" : `stages/${encodeURIComponent(stage)}/`}`
      await database
        .prepare(
          "DELETE FROM project_deployment_state WHERE project_id = ? AND scope = ? AND substr(state_key, 1, ?) = ?"
        )
        .bind(lease.projectId, lease.scope, prefix.length, prefix)
        .run()
      return new Response(null, { status: 204 })
    }
    if (method === "DELETE" && parts.length === 7 && parts[5] === "resources") {
      await database
        .prepare(
          "DELETE FROM project_deployment_state WHERE project_id = ? AND scope = ? AND state_key = ?"
        )
        .bind(lease.projectId, lease.scope, key)
        .run()
      return new Response(null, { status: 204 })
    }
    brokerDenied("unsupported Alchemy state operation")
  },
})
