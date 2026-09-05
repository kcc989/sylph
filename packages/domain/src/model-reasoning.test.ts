import { expect, test } from "bun:test"
import { Schema } from "effect"

import {
  WorkspacePromptInput,
  WorkspaceRuntimePromptInput,
} from "./conversation"
import { ModelSelection } from "./provider-connection"

const decodePrompt = Schema.decodeUnknownPromise(WorkspacePromptInput)
const decodeRuntimePrompt = Schema.decodeUnknownPromise(
  WorkspaceRuntimePromptInput
)
const encodeRuntimePrompt = Schema.encodePromise(WorkspaceRuntimePromptInput)

test("reasoning selection survives the user and runtime prompt boundaries", async () => {
  const input = await decodePrompt({
    workspaceId: "workspace-reasoning",
    text: "Build a todo list",
    model: {
      providerId: "openai",
      modelId: "reasoning-model",
      variant: "high",
    },
  })
  const runtime = await decodeRuntimePrompt({
    ...input,
    credential: { type: "key", key: "test-key" },
  })
  expect((await encodeRuntimePrompt(runtime)).model.variant).toBe("high")
})

test("default reasoning remains compatible with older model selections", async () => {
  const model = await Schema.decodeUnknownPromise(ModelSelection)({
    providerId: "openai",
    modelId: "reasoning-model",
  })
  expect(model.variant).toBeUndefined()
  expect(await Schema.encodePromise(ModelSelection)(model)).toEqual({
    providerId: "openai",
    modelId: "reasoning-model",
  })
})

test("empty reasoning levels cannot cross the prompt boundary", async () => {
  await expect(
    decodePrompt({
      workspaceId: "workspace-reasoning",
      text: "Continue",
      model: { providerId: "openai", modelId: "reasoning-model", variant: "" },
    })
  ).rejects.toThrow()
})
