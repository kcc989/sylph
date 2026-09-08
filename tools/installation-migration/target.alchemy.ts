import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import { Config, Effect } from "effect"
import type { WorkspaceDO } from "./bridge"

const Database = Cloudflare.D1.Database("Database", {})
const Website = Cloudflare.Worker(
  "Website",
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    if (!/^migration-[a-z0-9-]+$/.test(stage))
      throw new Error("Migration target requires a new migration-* stage")
    return {
      main: "tools/installation-migration/bridge.ts",
      compatibility: { flags: ["nodejs_compat"] },
      env: {
        DB: Database,
        WORKSPACES: Cloudflare.DurableObject<WorkspaceDO>("Workspaces", {
          className: "WorkspaceDO",
        }),
        MIGRATION_TOKEN: Config.redacted("SYLPH_INSTALLATION_MIGRATION_TOKEN"),
        MIGRATION_MODE: "target",
        MIGRATION_DATABASE_ID: Config.string(
          "SYLPH_INSTALLATION_MIGRATION_DATABASE_ID"
        ),
        MIGRATION_NAMESPACE_ID: Config.string(
          "SYLPH_INSTALLATION_MIGRATION_NAMESPACE_ID"
        ),
      },
    }
  })
)
export default Alchemy.Stack(
  "Sylph",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const website = yield* Website
    return { websiteUrl: website.url.as<string>() }
  })
)
