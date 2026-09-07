import {
  repairWorkspaceSql,
  repairIssueSql,
  linkRepairSql,
  repairPromptSql,
} from "@/server/project-operations"
import { effectiveConnection } from "@/server/provider-connections"
import { createServerFn } from "@tanstack/react-start"
import { env } from "cloudflare:workers"
import { Schema } from "effect"
import {
  ProjectRequestInput,
  WorkspaceId,
  WorkspacePromptInput,
  ProviderConnectionRequired,
} from "@workspace/domain"
import { Incident, IncidentAction } from "@workspace/domain/project-operations"
import { projectMember } from "./middleware"
import {
  readOperations,
  refreshOperations,
  repairBrief,
} from "@/server/project-operations"
import {
  scheduleWorkspaceProvisioning,
  scheduleWorkspaceMessageDelivery,
} from "@/server/workspace-runtime"

export const getProjectOperations = createServerFn({ method: "GET" })
  .middleware([projectMember])
  .validator(Schema.decodeUnknownPromise(ProjectRequestInput))
  .handler(({ data }) => readOperations(env.DB, data.projectId))
export const collectProjectHealth = createServerFn({ method: "POST" })
  .middleware([projectMember])
  .validator(Schema.decodeUnknownPromise(ProjectRequestInput))
  .handler(({ data }) =>
    refreshOperations(
      env.DB,
      { accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CF_TOKEN },
      data.projectId
    )
  )
export const acknowledgeProjectIncident = createServerFn({ method: "POST" })
  .middleware([projectMember])
  .validator(Schema.decodeUnknownPromise(IncidentAction))
  .handler(async ({ data }) => {
    await env.DB.prepare(
      "UPDATE project_incident SET status = 'acknowledged' WHERE id = ? AND project_id = ?"
    )
      .bind(data.incidentId, data.projectId)
      .run()
    return readOperations(env.DB, data.projectId)
  })
export const repairProjectIncident = createServerFn({ method: "POST" })
  .middleware([projectMember])
  .validator(Schema.decodeUnknownPromise(IncidentAction))
  .handler(async ({ data, context }) => {
    const row = await env.DB.prepare(
      "SELECT * FROM project_incident WHERE id = ? AND project_id = ?"
    )
      .bind(data.incidentId, data.projectId)
      .first()
    if (!row) throw new Error("Incident unavailable")
    const incident = Schema.decodeUnknownSync(Incident)(row)
    const connection = await effectiveConnection(
      context.database,
      context.project.organizationId,
      context.user.id
    )
    if (!connection)
      throw new ProviderConnectionRequired({
        message:
          "Connect a provider and enable a model before creating a repair Workspace",
      })
    const workspaceId = WorkspaceId.make(
      incident.workspace_id ?? crypto.randomUUID()
    )
    const issueId = incident.issue_id ?? crypto.randomUUID()
    const key = `repair:${incident.id}`
    const title = `Repair production ${incident.kind} ${incident.id.slice(0, 8)}`
    const brief = repairBrief(incident)
    const messageId = `incident-${incident.id}`
    const payload = Schema.encodeSync(WorkspacePromptInput)(
      new WorkspacePromptInput({
        workspaceId,
        messageId,
        text: brief,
        model: {
          providerId: connection.providerId,
          modelId: connection.modelId,
        },
        delivery: "queue",
      })
    )
    await env.DB.batch([
      env.DB.prepare(repairWorkspaceSql).bind(
        workspaceId,
        data.projectId,
        context.project.organizationId,
        context.user.id,
        key,
        title,
        `repair-${incident.id.slice(0, 8)}`,
        context.project.repositoryName,
        `${context.project.repositoryName.slice(0, 44)}-${workspaceId.replaceAll("-", "").slice(0, 12)}`,
        incident.commit
      ),
      env.DB.prepare(repairIssueSql).bind(
        issueId,
        context.project.organizationId,
        data.projectId,
        title,
        brief,
        context.user.id,
        data.projectId,
        incident.id
      ),
      env.DB.prepare(linkRepairSql).bind(
        data.projectId,
        key,
        issueId,
        incident.id,
        data.projectId
      ),
      env.DB.prepare(repairPromptSql).bind(
        messageId,
        JSON.stringify(payload),
        Date.now(),
        data.projectId,
        key
      ),
    ])
    const saved = await env.DB.prepare(
      "SELECT workspace_id FROM project_incident WHERE id = ? AND project_id = ?"
    )
      .bind(incident.id, data.projectId)
      .first<{ workspace_id: string }>()
    if (!saved) throw new Error("Repair Workspace could not be saved")
    await scheduleWorkspaceProvisioning(saved.workspace_id)
    await scheduleWorkspaceMessageDelivery({
      workspaceId: WorkspaceId.make(saved.workspace_id),
      messageId,
    })
    return { workspaceId: WorkspaceId.make(saved.workspace_id), brief }
  })
