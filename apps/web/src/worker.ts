export { CursorRuntimeContainer } from "./server/cursor-runtime-container"
import { Effect } from "effect"
import {
  ProjectDeploymentBroker,
  ProjectDeploymentBrokerLive,
} from "./server/deployment-broker"
import { deploymentBrokerStore } from "./server/deployment-broker-store"
export { ResourceMaintenance } from "./server/project-resource-maintenance"
import { env } from "cloudflare:workers"
import { smokeIdentityResponse } from "./server/smoke-identity"
import { canonicalInstallationResponse } from "./server/installation-address"
export { CodexContainer } from "./server/codex-container"
export { CursorConnectionObject as CursorContainer } from "./server/cursor-connection-object"
export { CiSandbox } from "@cloudflare/ci/worker"
export { WorkspaceDO } from "./server/workspace-do"
export { CI } from "./server/workspace-ci"
import { recoverWorkspaceJobs } from "./server/workspace-job-recovery"
import { refreshScheduledOperations } from "./server/project-operations"
export { WorkspaceMessageDelivery } from "./server/workspace-message-delivery"
export { ProjectSynchronization } from "./server/project-synchronization"
export { WorkspaceProvisioning } from "./server/workspace-provisioning"
import serverEntry from "@tanstack/react-start/server-entry"

import { refreshProviderCatalogs } from "@/server/provider-catalog-refresh"

export { WorkspaceMerge } from "./server/workspace-merge"
export { WorkspaceRetention } from "./server/workspace-retention"

export default {
  fetch: (request: Request) => {
    if (new URL(request.url).pathname.startsWith("/api/project-deployment/"))
      return Effect.runPromise(
        Effect.gen(function* () {
          const broker = yield* ProjectDeploymentBroker
          return yield* broker.handle(request)
        }).pipe(
          Effect.provide(
            ProjectDeploymentBrokerLive({
              store: deploymentBrokerStore(env.DB),
              token: env.CF_TOKEN,
            })
          ),
          Effect.catch(() =>
            Effect.succeed(
              Response.json(
                {
                  error:
                    "Deployment capability denied: request, plan, identity, or expiry is outside the approved scope",
                },
                { status: 403 }
              )
            )
          )
        )
      )
    return (
      smokeIdentityResponse(request, env) ??
      canonicalInstallationResponse(request, env.SYLPH_URL) ??
      serverEntry.fetch(request)
    )
  },
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
