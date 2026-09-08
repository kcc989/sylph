import type { ProjectResourceMaintenance } from "@workspace/domain/project-resources"
import type { ProjectSynchronization } from "./server/project-synchronization"
import type {
  WorkspaceProvisioningInput,
  WorkspaceCiInput,
  WorkspaceMessageDeliveryInput,
} from "@workspace/domain"
import type { CursorConnectionObject } from "./server/cursor-connection-object"
import type { WorkspaceDO } from "./server/workspace-do"
import type { WorkspaceMergeInput } from "./server/workspace-merge"
import type { WorkspaceRetentionInput } from "./server/workspace-retention"

declare global {
  namespace Cloudflare {
    interface Env {
      RESOURCE_TOKEN: string
      CLOUDFLARE_ACCOUNT_ID: string
      SYLPH_URL: string
      SYLPH_SMOKE_SOURCE_COMMIT: string
      SYLPH_SMOKE_TEMPLATE_COMMIT: string
      SYLPH_SMOKE_STAGE: string
      BETTER_AUTH_SECRET: string
      ALLOW_TEST_MAGIC_LINKS: string
      CURSOR: DurableObjectNamespace<CursorConnectionObject>
      DB: D1Database
      GITHUB_CLIENT_ID: string
      GITHUB_CLIENT_SECRET: string
      OAUTH_PROXY_URL: string
      OAUTH_PROXY_SECRET: string
      OAUTH_PROXY_TRUSTED_ORIGINS: string
      CREDENTIAL_ENCRYPTION_KEY: string
      INSTALLATION_CLAIM_SECRET: string
      PREVIEW_RETENTION_SECONDS: string
      REPOS: Artifacts
      CHECK_EVIDENCE: R2Bucket
      CI_WORKFLOW: Workflow<WorkspaceCiInput>
      CLOUDFLARE_ACCOUNT_ID: string
      CF_TOKEN: string
      RESOURCE_MAINTENANCE: Workflow<ProjectResourceMaintenance>
      REPOSITORY_NAMESPACE: string
      PROJECT_SYNCS: DurableObjectNamespace<ProjectSynchronization>
      MESSAGE_DELIVERY: Workflow<typeof WorkspaceMessageDeliveryInput.Encoded>
      PROVISIONING: Workflow<typeof WorkspaceProvisioningInput.Encoded>
      MERGES: Workflow<WorkspaceMergeInput>
      RETENTION: Workflow<WorkspaceRetentionInput>
      WORKSPACE_FORK_RETENTION_SECONDS: string
      WORKSPACES: DurableObjectNamespace<WorkspaceDO>
    }
  }
}

export {}
