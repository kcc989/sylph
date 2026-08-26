import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Effect from "effect/Effect"

export class Website extends Cloudflare.Website.Vite<Website>()("Website", {
  rootDir: "apps/web",
  compatibility: {
    flags: ["nodejs_compat"],
  },
  memo: {
    include: [
      "**/*",
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
