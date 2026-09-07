import {
  ProjectDomainInput,
  ProjectSecretInput,
} from "@workspace/domain/project-resources"
import {
  readProjectDomain,
  saveProjectDomain,
  saveProjectSecret,
} from "@/server/project-configuration"
import { createServerFn } from "@tanstack/react-start"
import { AccessDenied, ProjectRequestInput } from "@workspace/domain"
import {
  ProjectResourceAction,
  ProjectResourceOperation,
} from "@workspace/domain/project-resources"
import { env } from "cloudflare:workers"
import { Schema } from "effect"
import { projectMember } from "./middleware"
import {
  isOrganizationAdmin,
  requireOrganizationMembership,
} from "@/server/organization-access"
import { readProjectResources } from "@/server/project-resources"

export const getProjectResources = createServerFn({ method: "GET" })
  .middleware([projectMember])
  .validator(Schema.decodeUnknownPromise(ProjectRequestInput))
  .handler(async ({ data }) => {
    const resources = await readProjectResources(env.DB, data.projectId)
    const rows = await env.DB.prepare(
      "SELECT * FROM project_resource_operation WHERE project_id = ? ORDER BY scope"
    )
      .bind(data.projectId)
      .all()
    const operations = Schema.decodeUnknownSync(
      Schema.Array(ProjectResourceOperation)
    )(rows.results)
    return { resources, operations }
  })

export const maintainProjectResources = createServerFn({ method: "POST" })
  .middleware([projectMember])
  .validator(Schema.decodeUnknownPromise(ProjectResourceAction))
  .handler(async ({ data, context }) => {
    const membership = await requireOrganizationMembership(
      context.database,
      context.project.organizationId,
      context.user.id
    )
    if (!isOrganizationAdmin(membership.role))
      throw new AccessDenied({
        message: "Only Organization Admins can manage Project resources",
        resource: "project",
      })
    const row = await env.DB.prepare(
      "SELECT * FROM project_resource_operation WHERE project_id = ? AND scope = ?"
    )
      .bind(data.projectId, data.scope)
      .first()
    const operation = Schema.decodeUnknownSync(ProjectResourceOperation)(row)
    if (operation.status === "deploying")
      throw new Error("Wait for deployment to stop before managing resources")
    if (
      data.action === "cleanup" &&
      (!data.scope.startsWith("preview:") ||
        data.confirmedScope !== data.scope ||
        operation.status !== "cleanup_failed")
    ) {
      throw new Error("Confirm a failed Preview cleanup before retrying it")
    }
    if (data.action === "cleanup") {
      const original = await env.CI_WORKFLOW.get(operation.run_id)
      const status = await original.status()
      if (!["errored", "terminated", "complete"].includes(status.status))
        throw new Error(
          "Automatic cleanup is still running. Wait for its retries to finish."
        )
    }
    const workflow = await env.RESOURCE_MAINTENANCE.create({
      id: crypto.randomUUID(),
      params: {
        projectId: data.projectId,
        scope: data.scope,
        runId: operation.run_id,
        accountId: operation.account_id,
        action: data.action,
      },
    })
    return { workflowId: workflow.id }
  })

export const getProjectConfiguration = createServerFn({ method: "GET" })
  .middleware([projectMember])
  .validator(Schema.decodeUnknownPromise(ProjectRequestInput))
  .handler(async ({ data }) => {
    const rows = await env.DB.prepare(
      "SELECT environment, name FROM project_secret WHERE project_id = ? ORDER BY environment, name"
    )
      .bind(data.projectId)
      .all<{ environment: string; name: string }>()
    return {
      secrets: rows.results,
      domain: await readProjectDomain(env.DB, data.projectId),
    }
  })

export const setProjectSecret = createServerFn({ method: "POST" })
  .middleware([projectMember])
  .validator(Schema.decodeUnknownPromise(ProjectSecretInput))
  .handler(async ({ data, context }) => {
    const membership = await requireOrganizationMembership(
      context.database,
      context.project.organizationId,
      context.user.id
    )
    if (!isOrganizationAdmin(membership.role))
      throw new AccessDenied({
        message: "Only Organization Admins can manage Project secrets",
        resource: "project",
      })
    await saveProjectSecret(
      env.DB,
      data.projectId,
      data.environment,
      data.name,
      data.value,
      env.CREDENTIAL_ENCRYPTION_KEY
    )
    return { saved: true }
  })

export const setProjectDomain = createServerFn({ method: "POST" })
  .middleware([projectMember])
  .validator(Schema.decodeUnknownPromise(ProjectDomainInput))
  .handler(async ({ data, context }) => {
    const membership = await requireOrganizationMembership(
      context.database,
      context.project.organizationId,
      context.user.id
    )
    if (!isOrganizationAdmin(membership.role))
      throw new AccessDenied({
        message: "Only Organization Admins can manage Project domains",
        resource: "project",
      })
    await saveProjectDomain(env.DB, data.projectId, data.hostname, data.zoneId)
    return { saved: true }
  })
