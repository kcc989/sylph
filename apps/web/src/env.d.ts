import type { WorkspaceDO } from "./server/workspace-do"
import type { WorkspaceMergeInput } from "./server/workspace-merge"
import type { WorkspaceCiInput } from "./server/workspace-ci"

declare global {
  namespace Cloudflare {
    interface Env {
      BETTER_AUTH_SECRET: string
      ALLOW_TEST_MAGIC_LINKS: string
      DB: D1Database
      GITHUB_CLIENT_ID: string
      GITHUB_CLIENT_SECRET: string
      CREDENTIAL_ENCRYPTION_KEY: string
      INSTALLATION_CLAIM_SECRET: string
      REPOS: Artifacts
      CHECK_EVIDENCE: R2Bucket
      CI_WORKFLOW: Workflow<WorkspaceCiInput>
      REPOSITORY_NAMESPACE: string
      MERGES: Workflow<WorkspaceMergeInput>
      WORKSPACES: DurableObjectNamespace<WorkspaceDO>
    }
  }
}

export {}
