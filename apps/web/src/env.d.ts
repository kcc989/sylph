import type { WorkspaceDO } from "./server/workspace-do"

declare global {
  namespace Cloudflare {
    interface Env {
      BETTER_AUTH_SECRET: string
      DB: D1Database
      GITHUB_CLIENT_ID: string
      GITHUB_CLIENT_SECRET: string
      CREDENTIAL_ENCRYPTION_KEY: string
      REPOS: Artifacts
      WORKSPACES: DurableObjectNamespace<WorkspaceDO>
    }
  }
}

export {}
