import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import type { WorkspaceDO } from "./apps/web/src/server/workspace-do"
import type { WorkspaceMergeInput } from "./apps/web/src/server/workspace-merge"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"

const Database = Cloudflare.D1.Database("Database", {
  migrations: "packages/db/migrations",
})
const Repositories = Cloudflare.Artifacts.Namespace("Repositories")
const WorkspaceRuntime = Cloudflare.Worker("WorkspaceRuntime", {
  main: "apps/web/src/workspace-worker.ts",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  env: {
    REPOS: Repositories,
    WORKSPACES: Cloudflare.DurableObject<WorkspaceDO>("Workspaces", {
      className: "WorkspaceDO",
    }),
  },
})

export class Website extends Cloudflare.Website.Vite<Website>()(
  "Website",
  Effect.gen(function* () {
    const workspaceRuntime = yield* WorkspaceRuntime

    return {
      rootDir: "apps/web",
      main: "src/worker.ts",
      compatibility: {
        flags: ["nodejs_compat"],
      },
      env: {
        BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
        DB: Database,
        CREDENTIAL_ENCRYPTION_KEY: Config.redacted("CREDENTIAL_ENCRYPTION_KEY"),
        INSTALLATION_CLAIM_SECRET: Config.redacted("INSTALLATION_CLAIM_SECRET"),
        ALLOW_TEST_MAGIC_LINKS: Config.string("ALLOW_TEST_MAGIC_LINKS").pipe(
          Config.withDefault("false")
        ),
        GITHUB_CLIENT_ID: Config.string("GITHUB_CLIENT_ID").pipe(
          Config.withDefault("")
        ),
        GITHUB_CLIENT_SECRET: Config.redacted("GITHUB_CLIENT_SECRET").pipe(
          Config.withDefault(Redacted.make(""))
        ),
        REPOS: Repositories,
        MERGES: Cloudflare.Workflow<WorkspaceMergeInput>("WorkspaceMerge", {
          className: "WorkspaceMerge",
        }),
        WORKSPACES: Cloudflare.DurableObject<WorkspaceDO>("Workspaces", {
          className: "WorkspaceDO",
          scriptName: workspaceRuntime.workerName,
        }),
      },
      memo: {
        include: [
          "**/*",
          "../../packages/db/src/**",
          "../../packages/db/migrations/**",
          "../../packages/domain/src/**",
          "../../packages/ui/src/**",
        ],
        lockfile: true,
      },
    }
  })
) {}

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>

export default Alchemy.Stack(
  "Sylph",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const website = yield* Website

    return {
      websiteUrl: website.url.as<string>(),
    }
  })
)
