import { openCodeLogging } from "./opencode-logging"
import { openCodeCacheLayer } from "./opencode-cache"
import { KV } from "@opencode-ai/core/kv"
import { OpenCode } from "@opencode-ai/client"
import { PluginPromise } from "@opencode-ai/core/plugin/promise"
import { ConfigPluginSource } from "@opencode-ai/core/config/plugin/source"
import { SessionRestart } from "@opencode-ai/core/session/execution/restart"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import type { Plugin } from "@opencode-ai/plugin"
import { ServerFetch } from "@opencode-ai/server/fetch"
import { ServerWorkerd } from "@opencode-ai/server/workerd"
import type { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd"
import { Context, Effect, Exit, Layer, Scope, Stream } from "effect"

export const createOpenCodeRuntime = async (
  options: Omit<OpenCodeWorkerd.CreateOptions, "log">,
  boot: ServerFetch.BootOptions = {}
) => {
  const scope = Effect.runSync(Scope.make())
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void))
  let register = async (_plugin: Plugin.Plugin): Promise<void> => {
    throw new Error("OpenCode runtime has not started")
  }
  const plugins = SdkPlugins.layer.pipe(
    Layer.tap((context) =>
      Effect.gen(function* () {
        const service = Context.get(context, SdkPlugins.Service)
        register = (plugin) =>
          Effect.runPromise(service.register(PluginPromise.fromPromise(plugin)))
        for (const plugin of options.plugins ?? [])
          yield* service.register(PluginPromise.fromPromise(plugin))
      })
    )
  )
  const profile = {
    ...options,
    config: { content: JSON.stringify(options.config ?? {}) },
  }
  try {
    const logging = await Effect.runPromise(
      Layer.build(openCodeLogging).pipe(
        Effect.provideService(Scope.Scope, scope)
      )
    )
    const handle = await Effect.runPromise(
      ServerFetch.make(ServerWorkerd.serverOptions(profile), {
        overrides: [
          ...ServerWorkerd.replacements(profile),
          [KV.node, { ...KV.node, implementation: openCodeCacheLayer }],
          [
            SessionRestart.node,
            {
              ...SessionRestart.node,
              implementation: SessionRestart.layer({ maxAttempts: 2 }),
            },
          ],
          [
            ConfigPluginSource.node,
            {
              ...ConfigPluginSource.empty,
              implementation: Layer.succeed(
                ConfigPluginSource.Service,
                ConfigPluginSource.Service.of({
                  operations: () =>
                    Effect.succeed([
                      { type: "remove", target: "opencode.provider.dynamic" },
                    ]),
                  changes: () => Stream.never,
                })
              ),
            },
          ],
          ...(boot.overrides ?? []),
          [SdkPlugins.node, { ...SdkPlugins.node, implementation: plugins }],
        ],
      }).pipe(
        Effect.provide(logging),
        Effect.provideService(Scope.Scope, scope)
      )
    )
    const transport = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) =>
        handle(new Request(input, init), logging),
      { preconnect: globalThis.fetch.preconnect }
    )
    const client = OpenCode.make({
      baseUrl: "http://opencode.local",
      fetch: transport,
    })
    return {
      ...client,
      sessions: client.session,
      events: client.event,
      plugin: Object.assign(register, client.plugin),
      close,
      [Symbol.asyncDispose]: close,
    }
  } catch (error) {
    await close()
    throw error
  }
}
