import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import { ProjectResourceMaintenance } from "@workspace/domain/project-resources"
import { CiRunSummary } from "@workspace/domain"
import { Schema } from "effect"
import type { WorkspaceDO } from "./workspace-do"
import {
  captureProjectResources,
  removePreviewResources,
} from "./project-resources"

interface MaintenanceBindings {
  DB: D1Database
  CF_TOKEN: string
  CLOUDFLARE_ACCOUNT_ID: string
  WORKSPACES: DurableObjectNamespace<WorkspaceDO>
}

export class ResourceMaintenance extends WorkflowEntrypoint<
  MaintenanceBindings,
  ProjectResourceMaintenance
> {
  async run(
    event: WorkflowEvent<ProjectResourceMaintenance>,
    step: WorkflowStep
  ) {
    const input = Schema.decodeUnknownSync(ProjectResourceMaintenance)(
      event.payload
    )
    if (input.accountId !== this.env.CLOUDFLARE_ACCOUNT_ID)
      throw new Error("Resource account does not match this installation")
    const credentials = { accountId: input.accountId, token: this.env.CF_TOKEN }
    await step.do("maintain-project-resources", async () => {
      const operation = await this.env.DB.prepare(
        "SELECT status, run_id FROM project_resource_operation WHERE account_id = ? AND project_id = ? AND scope = ?"
      )
        .bind(input.accountId, input.projectId, input.scope)
        .first<{ status: string; run_id: string }>()
      if (
        !operation ||
        operation.run_id !== input.runId ||
        operation.status === "deploying"
      )
        throw new Error("Resource deployment is still running or has changed")
      try {
        if (input.action === "cleanup")
          await removePreviewResources(this.env.DB, credentials, input)
        else {
          if (operation.status === "deleted")
            throw new Error("These resources have been deleted")
          await captureProjectResources(this.env.DB, credentials, input, true)
        }
        await this.env.DB.prepare(
          "UPDATE project_resource_operation SET error = NULL WHERE account_id = ? AND project_id = ? AND scope = ? AND run_id = ?"
        )
          .bind(input.accountId, input.projectId, input.scope, input.runId)
          .run()
      } catch (cause) {
        await this.env.DB.prepare(
          "UPDATE project_resource_operation SET error = ? WHERE account_id = ? AND project_id = ? AND scope = ? AND run_id = ?"
        )
          .bind(
            cause instanceof Error
              ? cause.message
              : "Resource maintenance failed",
            input.accountId,
            input.projectId,
            input.scope,
            input.runId
          )
          .run()
        throw cause
      }
    })
    if (input.action === "cleanup")
      await step.do("clear-preview-url", async () => {
        const ci = await this.env.DB.prepare(
          "SELECT id, workspace_id, summary_json FROM ci_runs WHERE project_id = ? AND workflow_instance_id = ?"
        )
          .bind(input.projectId, input.runId)
          .first<{ id: string; workspace_id: string; summary_json: string }>()
        if (!ci) return
        const workspace = this.env.WORKSPACES.get(
          this.env.WORKSPACES.idFromName(ci.workspace_id)
        )
        const summary = Schema.decodeUnknownSync(CiRunSummary)(
          JSON.parse(ci.summary_json)
        )
        if (input.scope === `preview:${ci.id}:${summary.attempt}`)
          await workspace.expireCheckPreview({
            runId: ci.id,
            attempt: summary.attempt,
            callbackId: `${event.instanceId}:preview-expired`,
          })
        await this.env.DB.prepare(
          "UPDATE ci_runs SET summary_json = json_set(summary_json, '$.previewUrl', NULL) WHERE project_id = ? AND workflow_instance_id = ?"
        )
          .bind(input.projectId, input.runId)
          .run()
      })
  }
}
