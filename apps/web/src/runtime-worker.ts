export { CursorRuntimeContainer } from "./server/cursor-runtime-container"
export { ResourceMaintenance } from "./server/project-resource-maintenance"
export { CodexContainer } from "./server/codex-container"
export { CursorConnectionObject as CursorContainer } from "./server/cursor-connection-object"
export { CiSandbox } from "@cloudflare/ci/worker"
export { Sandbox as WorkspaceSandbox } from "@cloudflare/sandbox"
export { WorkspaceDO } from "./server/workspace-do"
export { CI } from "./server/workspace-ci"
export { WorkspaceMessageDelivery } from "./server/workspace-message-delivery"
export { ProjectSynchronization } from "./server/project-synchronization"
export { WorkspaceProvisioning } from "./server/workspace-provisioning"
export { WorkspaceMerge } from "./server/workspace-merge"
export { WorkspaceRetention } from "./server/workspace-retention"
import { env } from "cloudflare:workers"
import { recoverWorkspaceJobs } from "./server/workspace-job-recovery"
import { refreshScheduledOperations } from "./server/project-operations"
import { refreshProviderCatalogs } from "./server/provider-catalog-refresh"

export default {
  fetch: (request: Request) => env.FRONTEND.fetch(request),
  async scheduled(controller: ScheduledController) {
    if (controller.cron === "* * * * *") {
      await Promise.all([
        recoverWorkspaceJobs(),
        refreshScheduledOperations(env.DB, {
          accountId: env.CLOUDFLARE_ACCOUNT_ID,
          token: env.CF_TOKEN,
        }).then((result) => {
          if (result.failed > 0)
            console.error("Scheduled health collection failed", result)
        }),
      ])
      return
    }
    const result = await refreshProviderCatalogs()
    console.info("Provider catalog refresh completed", result)
  },
}
