import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PromiseSdk } from "../../node_modules/@opencode-ai/sdk/dist/promise"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { SessionRestart } from "@opencode-ai/core/session/execution/restart"
import { Effect, Layer } from "effect"

test("registers every initial plugin before suspended-session recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sylph-recovery-"))
  let report: (ids: string[]) => void = () => {}
  const recovered = new Promise<string[]>((resolve) => {
    report = resolve
  })
  const restart = Layer.effect(
    SessionRestart.Service,
    Effect.gen(function* () {
      const plugins = yield* SdkPlugins.Service
      return {
        resumeSuspendedSessions: Effect.sync(() => {
          report(plugins.all().map((plugin) => plugin.id))
        }),
      }
    })
  )
  const pluginIds = [
    "workspace-files",
    "workspace-execution",
    "workspace-permissions",
  ]
  try {
    await using host = await PromiseSdk.create(
      {
        models: { fetch: false, snapshot: false },
        config: { directory, project: false, content: "{}" },
        database: { path: join(directory, "opencode.db") },
        fs: { filewatcher: false, fff: false },
        plugins: pluginIds.map((id) => ({ id, async setup() {} })),
      },
      { overrides: [[SessionRestart.node, restart]] }
    )
    expect(await recovered).toEqual(pluginIds)
    expect((await host.health.get()).healthy).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 15000)
