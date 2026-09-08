import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import { Config, Effect } from "effect"

const Drill = Cloudflare.D1.Database(
  "Drill",
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    if (!/^recovery-drill-[a-z0-9-]{1,30}$/.test(stage))
      return yield* Effect.die(new Error("Use a new recovery-drill-* stage"))
    const migrations = yield* Config.string(
      "SYLPH_RECOVERY_DRILL_MIGRATIONS"
    ).pipe(Config.withDefault(""), Effect.orDie)
    return { name: `sylph-${stage}`, migrations: migrations || undefined }
  })
)

export default Alchemy.Stack(
  "SylphRecoveryDrill",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const drill = yield* Drill
    return { databaseId: drill.databaseId, databaseName: drill.databaseName }
  })
)
