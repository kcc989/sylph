export { ResourceMaintenance } from "./server/project-resource-maintenance"
import { env } from "cloudflare:workers"
import { canonicalInstallationResponse } from "./server/installation-address"
export { CodexContainer } from "./server/codex-container"
export { CursorConnectionObject as CursorContainer } from "./server/cursor-connection-object"
export { CiSandbox } from "@cloudflare/ci/worker"
export { WorkspaceDO } from "./server/workspace-do"
export { CI } from "./server/workspace-ci"
import { recoverWorkspaceJobs } from "./server/workspace-job-recovery"
export { WorkspaceMessageDelivery } from "./server/workspace-message-delivery"
export { ProjectSynchronization } from "./server/project-synchronization"
export { WorkspaceProvisioning } from "./server/workspace-provisioning"
import serverEntry from "@tanstack/react-start/server-entry"

import { refreshProviderCatalogs } from "@/server/provider-catalog-refresh"

export { WorkspaceMerge } from "./server/workspace-merge"
export { WorkspaceRetention } from "./server/workspace-retention"

export default {
  fetch: (request: Request) =>
    canonicalInstallationResponse(request, env.SYLPH_URL) ??
    serverEntry.fetch(request),
  async scheduled(controller: ScheduledController) {
    if (controller.cron === "* * * * *") {
      await recoverWorkspaceJobs()
      return
    }
    const result = await refreshProviderCatalogs()
    console.info("Provider catalog refresh completed", result)
  },
}
