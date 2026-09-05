import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Effect from "effect/Effect"
import type { CodexProbe } from "./probe"

const Probe = Cloudflare.Worker("Probe", {
  main: "tools/codex-smoke/probe.ts",
  compatibility: { flags: ["nodejs_compat"] },
  env: {
    PROBE: Cloudflare.Container<CodexProbe>("Container", {
      image: "docker.io/library/node:24-alpine",
      className: "CodexProbe",
      instanceType: "basic",
      maxInstances: 1,
    }),
  },
})

export default Alchemy.Stack(
  "SylphCodexProbe",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const probe = yield* Probe
    return { url: probe.url }
  })
)
