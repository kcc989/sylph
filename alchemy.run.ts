import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import type { WorkspaceDO } from "./apps/web/src/server/workspace-do"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"

const Database = Cloudflare.D1.Database("Database", {
  migrations: "packages/db/migrations",
})
const Repositories = Cloudflare.Artifacts.Namespace("Repositories")
const Workspaces = Cloudflare.DurableObject<WorkspaceDO>("Workspaces", {
  className: "WorkspaceDO",
})

export class Website extends Cloudflare.Website.Vite<Website>()("Website", {
  rootDir: "apps/web",
  main: "src/worker.ts",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  env: {
    BETTER_AUTH_SECRET: Config.redacted("BETTER_AUTH_SECRET"),
    DB: Database,
    GITHUB_CLIENT_ID: Config.string("GITHUB_CLIENT_ID"),
    GITHUB_CLIENT_SECRET: Config.redacted("GITHUB_CLIENT_SECRET"),
    CREDENTIAL_ENCRYPTION_KEY: Config.redacted("CREDENTIAL_ENCRYPTION_KEY"),
    REPOS: Repositories,
    WORKSPACES: Workspaces,
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
}) {}

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
