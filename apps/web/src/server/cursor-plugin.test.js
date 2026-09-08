import { expect, test } from "bun:test"
import { createCursorProvider } from "./cursor-plugin"

const fixture = (saved = new Map()) => {
  let connected = false
  let resolutions = 0
  let transform
  let models = []
  const aiSdkHooks = new Map()
  const dispose = async () => undefined
  const registration = async () => ({ dispose })
  const replay = () => {
    const next = []
    transform({
      provider: { update: (_id, update) => update({}) },
      model: {
        update: (_provider, id, update) => {
          const model = { id }
          update(model)
          next.push(model)
        },
      },
    })
    models = structuredClone(next)
  }
  const provider = createCursorProvider(
    {
      idFromName: (name) => name,
      get: () => ({
        fetch: async () =>
          Response.json([
            { id: "default", name: "Auto", context: 128000, images: true },
          ]),
      }),
    },
    {
      get: async (key) => saved.get(key),
      put: async (key, value) => saved.set(key, structuredClone(value)),
    }
  )
  const context = {
    integration: {
      transform: registration,
      connection: {
        active: async () => {
          resolutions += 1
          return connected ? { id: "test" } : undefined
        },
        resolve: async () => ({
          type: "key",
          key: JSON.stringify({ userId: "test-user", key: "test-key" }),
        }),
      },
    },
    catalog: {
      transform: async (callback) => {
        transform = callback
        replay()
        return { dispose }
      },
      reload: async () => replay(),
    },
    session: { hook: registration },
    aisdk: {
      hook: async (name, callback) => {
        aiSdkHooks.set(name, callback)
        return { dispose }
      },
    },
  }
  return {
    provider,
    context,
    connect: () => {
      connected = true
    },
    models: () => models,
    resolutions: () => resolutions,
    aiSdkHooks,
  }
}

test("Cursor models are registered synchronously when the host replays the catalog", async () => {
  const state = fixture()
  const cleanup = await state.provider.plugin.setup(state.context)
  expect(state.models()).toEqual([])
  state.connect()
  await state.provider.refresh(
    JSON.stringify({ userId: "test-user", key: "test-key" })
  )
  expect(state.models().map((model) => model.id)).toEqual(["default"])
  await cleanup()
})

test("Cursor models can be prepared before OpenCode lazily starts the plugin", async () => {
  const state = fixture()
  state.connect()
  const refresh = state.provider.refresh(
    JSON.stringify({ userId: "test-user", key: "test-key" })
  )
  await refresh
  const cleanup = await state.provider.plugin.setup(state.context)
  expect(state.models().map((model) => model.id)).toEqual(["default"])
  await cleanup()
})

test("Cursor setup does not resolve credentials while OpenCode registers plugins", async () => {
  const state = fixture()
  state.connect()
  const cleanup = await state.provider.plugin.setup(state.context)
  expect(state.resolutions()).toBe(0)
  await state.provider.refresh(
    JSON.stringify({ userId: "test-user", key: "test-key" })
  )
  expect(state.resolutions()).toBe(0)
  await cleanup()
})

test("Cursor SDK supplies the language model through the host fallback", async () => {
  const state = fixture()
  const cleanup = await state.provider.plugin.setup(state.context)
  const event = {
    model: { providerID: "cursor" },
    package: "sylph-cursor",
    options: {},
  }
  await state.aiSdkHooks.get("sdk")(event)
  const model = event.sdk.languageModel("default")
  expect(model.provider).toBe("cursor")
  expect(model.modelId).toBe("default")
  expect(state.aiSdkHooks.has("language")).toBe(false)
  await cleanup()
})

test("Cursor catalog survives a Workspace restart before session recovery", async () => {
  const saved = new Map()
  const first = fixture(saved)
  await first.provider.refresh(
    JSON.stringify({ userId: "test-user", key: "test-key" })
  )
  const restarted = fixture(saved)
  await restarted.provider.restore()
  const cleanup = await restarted.provider.plugin.setup(restarted.context)
  expect(restarted.models().map((model) => model.id)).toEqual(["default"])
  expect(restarted.resolutions()).toBe(0)
  await cleanup()
})
