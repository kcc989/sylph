import type { WorkspaceCommandFile } from "@workspace/domain/workspace-command"
import { Model } from "@opencode-ai/schema/model"
import { Integration } from "@opencode-ai/schema/integration"
import { Plugin } from "@opencode-ai/plugin"
import { CursorHandle, CursorModels } from "@workspace/domain/cursor-provider"
import { Schema } from "effect"
import { cursorLanguageModel } from "./cursor-language-model"

const decodeHandle = Schema.decodeUnknownPromise(CursorHandle)
const decodeModels = Schema.decodeUnknownPromise(CursorModels)

export const createCursorProvider = (
  namespace: DurableObjectNamespace,
  storage: Pick<DurableObjectStorage, "get" | "put">,
  files: () => readonly WorkspaceCommandFile[]
) => {
  let models: typeof CursorModels.Type = []
  const catalogs = new Set<() => Promise<void>>()
  const send = (userId: string, request: Request) =>
    namespace.get(namespace.idFromName(userId)).fetch(request)
  const plugin = Plugin.define({
    id: "sylph-cursor",
    async setup(context) {
      const credential = async () => {
        const active = await context.integration.connection.active("cursor")
        const value = active
          ? await context.integration.connection.resolve(active)
          : undefined
        if (value?.type !== "key")
          throw new Error("Connect your Cursor account")
        return value.key
      }
      const integration = await context.integration.transform((draft) => {
        draft.update("cursor", (value) => {
          value.name = "Cursor"
        })
        draft.method.update({
          integrationID: "cursor",
          method: { type: "key", label: "Sylph personal connection" },
        })
      })
      const catalog = await context.catalog.transform((draft) => {
        draft.provider.update("cursor", (value) => {
          value.name = "Cursor"
          value.package = "aisdk:sylph-cursor"
          value.integrationID = Integration.ID.make("cursor")
        })
        for (const model of models)
          draft.model.update("cursor", model.id, (value) => {
            value.modelID = Model.ID.make(model.modelId ?? model.id)
            value.name = model.name
            value.settings = model.settings
            value.variants = (model.variants ?? []).map((variant) => ({
              id: Model.VariantID.make(variant.id),
              settings: variant.settings,
            }))
            value.enabled = true
            value.status = "active"
            value.limit = {
              context: model.context,
              output: model.output ?? 32_000,
            }
            value.capabilities = {
              tools: true,
              input: model.images ? ["text", "image"] : ["text"],
              output: ["text"],
            }
          })
      })
      const reloadCatalog = () => context.catalog.reload()
      catalogs.add(reloadCatalog)
      const request = await context.session.hook("model.request", (event) => {
        if (event.model.providerID === "cursor")
          event.headers["x-sylph-cursor-compaction"] =
            event.agent === "compaction" ? "true" : "false"
      })
      const sdk = await context.aisdk.hook("sdk", (event) => {
        if (event.model.providerID === "cursor")
          event.sdk = {
            languageModel: (modelId: string) =>
              cursorLanguageModel(modelId, credential, send, files),
          }
      })
      return async () => {
        catalogs.delete(reloadCatalog)
        await request.dispose()
        await sdk.dispose()
        await catalog.dispose()
        await integration.dispose()
      }
    },
  })

  return {
    plugin,
    restore: async () => {
      const saved = await storage.get("cursor-models")
      if (saved !== undefined) models = await decodeModels(saved)
    },
    refresh: async (key: string) => {
      const handle = await decodeHandle(JSON.parse(key))
      const response = await send(
        handle.userId,
        new Request("http://cursor/", {
          method: "POST",
          body: JSON.stringify({ operation: "models", key: handle.key }),
        })
      )
      if (!response.ok) throw new Error("Could not load Cursor models")
      models = await decodeModels(await response.json())
      await storage.put("cursor-models", models)
      await Promise.all(Array.from(catalogs, (reload) => reload()))
    },
  }
}
