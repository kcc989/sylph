import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"
import { env } from "cloudflare:workers"
import {
  AccessDenied,
  ProviderConnectionRequired,
  WorkspaceId,
  WorkspacePromptInput,
} from "@workspace/domain"
import {
  ResourceRemovalSelection,
  ResourceRemovalPreparationRequest,
} from "@workspace/domain/project-resources"
import { projectMember } from "./middleware"
import {
  isOrganizationAdmin,
  requireOrganizationMembership,
} from "@/server/organization-access"
import { repositoryStore } from "@/server/repositories"
import {
  inspectResourceRemoval,
  requireCurrentRemovalPreparation,
  removalPreparationPrompt,
} from "@/server/resource-removal-preparation"
import { effectiveConnection } from "@/server/provider-connections"
import { capabilityHash } from "@/server/deployment-broker"
import {
  repairWorkspaceSql,
  repairPromptSql,
} from "@/server/project-operations"
import {
  scheduleWorkspaceProvisioning,
  scheduleWorkspaceMessageDelivery,
} from "@/server/workspace-runtime"

export const reviewResourceRemovalPreparation = createServerFn({
  method: "POST",
})
  .middleware([projectMember])
  .validator(Schema.decodeUnknownPromise(ResourceRemovalSelection))
  .handler(async ({ data, context }) => {
    const membership = await requireOrganizationMembership(
      context.database,
      context.project.organizationId,
      context.user.id
    )
    if (!isOrganizationAdmin(membership.role))
      throw new AccessDenied({
        message: "Only Organization Admins can prepare resource removal",
        resource: "project",
      })
    const head = await Effect.runPromise(
      repositoryStore().head(context.project.repositoryName)
    )
    return inspectResourceRemoval(
      env.DB,
      { accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.RESOURCE_TOKEN },
      data,
      head
    )
  })

export const createResourceRemovalWorkspace = createServerFn({ method: "POST" })
  .middleware([projectMember])
  .validator(Schema.decodeUnknownPromise(ResourceRemovalPreparationRequest))
  .handler(async ({ data, context }) => {
    const membership = await requireOrganizationMembership(
      context.database,
      context.project.organizationId,
      context.user.id
    )
    if (!isOrganizationAdmin(membership.role))
      throw new AccessDenied({
        message: "Only Organization Admins can prepare resource removal",
        resource: "project",
      })
    const selection = Schema.decodeUnknownSync(ResourceRemovalSelection)({
      projectId: data.projectId,
      resources: data.preparation.inventory.map((item) => ({
        kind: item.kind,
        name: item.name,
        resourceId: item.resource_id,
        generation: item.generation,
      })),
    })
    const head = await Effect.runPromise(
      repositoryStore().head(context.project.repositoryName)
    )
    const current = await inspectResourceRemoval(
      env.DB,
      { accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.RESOURCE_TOKEN },
      selection,
      head
    )
    requireCurrentRemovalPreparation(data.preparation, current)
    const connection = await effectiveConnection(
      context.database,
      context.project.organizationId,
      context.user.id
    )
    if (!connection)
      throw new ProviderConnectionRequired({
        message:
          "Connect a provider and enable a model before creating a removal Workspace",
      })
    const id = WorkspaceId.make(crypto.randomUUID())
    const key = `removal:${await capabilityHash(JSON.stringify(current))}`
    const messageId = key
    const payload = Schema.encodeSync(WorkspacePromptInput)(
      new WorkspacePromptInput({
        workspaceId: id,
        messageId,
        text: removalPreparationPrompt(current),
        model: {
          providerId: connection.providerId,
          modelId: connection.modelId,
        },
        delivery: "queue",
      })
    )
    await env.DB.batch([
      env.DB.prepare(repairWorkspaceSql).bind(
        id,
        data.projectId,
        context.project.organizationId,
        context.user.id,
        key,
        "Prepare production resource removal",
        `remove-${id.slice(0, 8)}`,
        context.project.repositoryName,
        `${context.project.repositoryName.slice(0, 44)}-${id.replaceAll("-", "").slice(0, 12)}`,
        current.baseCommit
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
      "SELECT id FROM workspace WHERE project_id = ? AND creation_key = ?"
    )
      .bind(data.projectId, key)
      .first<{ id: string }>()
    if (!saved) throw new Error("Removal Workspace could not be saved")
    await scheduleWorkspaceProvisioning(saved.id)
    await scheduleWorkspaceMessageDelivery({
      workspaceId: WorkspaceId.make(saved.id),
      messageId,
    })
    return { workspaceId: saved.id, projectSlug: context.project.slug }
  })
