import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EmbeddedHost } from "../../node_modules/@opencode-ai/sdk/dist/internal/host"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { KV } from "@opencode-ai/core/kv"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"

test("retains the live model catalog when persistent cache writes fail", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sylph-model-cache-"))
  let fetches = 0
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      fetches += 1
      return HttpClientResponse.fromWeb(
        request,
        Response.json({
          fixture: {
            id: "fixture",
            name: "Fixture",
            npm: "@ai-sdk/openai-compatible",
            env: [],
            models: {},
          },
        })
      )
    })
  )
  const models = ModelsDev.layer({ fetch: false, snapshot: false }).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http))
  )
  const kv = Layer.succeed(KV.Service, {
    get: () => Effect.undefined,
    set: () => Effect.die(new Error("SQLITE_TOOBIG")),
    remove: () => Effect.void,
    scan: () => Effect.succeed({ entries: [] }),
  })
  try {
    const host = await Effect.runPromise(
      EmbeddedHost.create({
        models: { fetch: false, snapshot: false },
        config: { directory, project: false, content: "{}" },
        database: { path: join(directory, "opencode.db") },
        fs: { filewatcher: false, fff: false },
        log: { level: "error", emit() {} },
      })
    )
    try {
      await host.runtime.runPromise(
        Effect.gen(function* () {
          const catalog = yield* ModelsDev.Service
          yield* catalog.refresh(true)
          expect(
            (yield* catalog.get()).map((provider) => String(provider.info.id))
          ).toEqual(["fixture"])
          yield* catalog.refresh()
          expect(fetches).toBe(1)
          expect((yield* catalog.get()).length).toBe(1)
        }).pipe(
          Effect.provide(
            models.pipe(
              Layer.provide(kv),
              Layer.provide(LayerNode.compile(FSUtil.node))
            )
          )
        )
      )
    } finally {
      await host.runtime.dispose()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
