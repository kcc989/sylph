import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"

import {
  forkDeletedSql,
  forkRetentionExpired,
  retainedWorkspaceSql,
  workspaceForkRetention,
  type RetainedWorkspaceRow,
  type WorkspaceRetentionInput,
} from "./workspace-fork-retention"

export type { WorkspaceRetentionInput } from "./workspace-fork-retention"

type WorkspaceRetentionBindings = {
  DB: D1Database
  REPOS: Artifacts
  WORKSPACE_FORK_RETENTION_SECONDS: string
}

export class WorkspaceRetention extends WorkflowEntrypoint<
  WorkspaceRetentionBindings,
  WorkspaceRetentionInput
> {
  async run(
    event: Readonly<WorkflowEvent<WorkspaceRetentionInput>>,
    step: WorkflowStep
  ) {
    const input = event.payload
    await step.sleep(
      "retain-workspace-fork",
      workspaceForkRetention(this.env.WORKSPACE_FORK_RETENTION_SECONDS)
    )
    const expired = await step.do("read-retained-workspace", async () => {
      const row = await this.env.DB.prepare(retainedWorkspaceSql)
        .bind(input.workspaceId)
        .first<RetainedWorkspaceRow>()
      return forkRetentionExpired(input, row)
    })
    if (!expired) return { status: "retained" as const }
    await step.do(
      "delete-workspace-fork",
      { retries: { limit: 5, delay: "1 minute", backoff: "exponential" } },
      async () => {
        await this.env.REPOS.delete(input.workspaceRepositoryName)
      }
    )
    await step.do("record-fork-deletion", async () => {
      await this.env.DB.prepare(forkDeletedSql).bind(input.workspaceId).run()
    })
    return { status: "deleted" as const }
  }
}
