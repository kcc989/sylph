import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import { Config, Effect } from "effect"
import { Stage } from "alchemy/Stage"

import type { BrowserSmoke } from "./worker"

export default Alchemy.Stack(
  "SylphBrowserSmoke",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Stage
    if (!stage.startsWith("smoke-"))
      throw new Error("Browser smoke requires a disposable smoke-* stage")
    const worker = yield* Cloudflare.Worker("BrowserSmoke", {
      main: "tools/browser-smoke/worker.ts",
      compatibility: { flags: ["nodejs_compat"] },
      env: {
        BROWSER: Cloudflare.Browser("BROWSER"),
        DB: Cloudflare.D1.Database("BrowserSmokeData"),
        EVIDENCE: Cloudflare.R2.Bucket("BrowserSmokeEvidence"),
        SESSIONS: Cloudflare.DurableObject<BrowserSmoke>(
          "BrowserSmokeSessions",
          { className: "BrowserSmoke" }
        ),
        SMOKE_TOKEN: Config.redacted("SYLPH_BROWSER_SMOKE_TOKEN"),
        SMOKE_COMMIT: Config.string("SYLPH_BROWSER_SMOKE_COMMIT"),
        SMOKE_SOURCE: Config.string("SYLPH_BROWSER_SMOKE_SOURCE"),
      },
    })
    return { browserSmokeUrl: worker.url }
  })
)
