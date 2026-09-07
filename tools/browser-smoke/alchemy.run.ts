import * as Output from "alchemy/Output"
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
    const database = Cloudflare.D1.Database("BrowserSmokeData")
    const oauth = yield* Cloudflare.Worker("BrowserSmokeOAuth", {
      main: "tools/browser-smoke/oauth.ts",
      compatibility: { flags: ["nodejs_compat"] },
      env: {
        DB: database,
        SMOKE_TOKEN: Config.redacted("SYLPH_BROWSER_SMOKE_TOKEN"),
      },
    })
    const worker = yield* Cloudflare.Worker("BrowserSmoke", {
      main: "tools/browser-smoke/worker.ts",
      compatibility: { flags: ["nodejs_compat"] },
      env: {
        BROWSER: Cloudflare.Browser("BROWSER"),
        DB: database,
        SMOKE_OAUTH_ORIGIN: Output.map(oauth.url, (url) => {
          if (!url) throw new Error("External fixture has no URL")
          return new URL(url).origin
        }),
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
    return { browserSmokeUrl: worker.url, browserSmokeOAuthUrl: oauth.url }
  })
)
