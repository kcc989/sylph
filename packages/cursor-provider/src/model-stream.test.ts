import { expect, test } from "bun:test"
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"
import { CursorServerError } from "cursor-opencode-provider/errors"
import { cursorModelStream } from "./model-stream"

const requiredMax = () =>
  new CursorServerError("Max Mode Required", {
    code: "invalid_argument",
    transient: false,
    replaySafe: true,
  })

const fixture = (prefix: LanguageModelV3StreamPart[] = []) => {
  const requests: Parameters<LanguageModelV3["doStream"]>[0][] = []
  const model: LanguageModelV3 = {
    specificationVersion: "v3",
    provider: "cursor",
    modelId: "fixture",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("Streaming fixture")
    },
    async doStream(options) {
      requests.push(options)
      const parts: LanguageModelV3StreamPart[] =
        options.providerOptions?.cursor?.maxMode === true
          ? [
              { type: "stream-start", warnings: [] },
              { type: "text-delta", id: "text", delta: "ready" },
            ]
          : [{ type: "stream-start", warnings: [] }, ...prefix]
      return {
        stream: new ReadableStream({
          pull(controller) {
            const part = parts.shift()
            if (part) controller.enqueue(part)
            else if (options.providerOptions?.cursor?.maxMode === true)
              controller.close()
            else controller.error(requiredMax())
          },
        }),
      }
    },
  }
  return { model, requests }
}

test("Cursor retries a Max Mode requirement before any model content", async () => {
  const { model, requests } = fixture()
  const parts = await Array.fromAsync(cursorModelStream(model, { prompt: [] }))
  expect(requests.length).toBe(2)
  expect(requests[1]?.providerOptions?.cursor?.maxMode).toBe(true)
  expect(parts.filter((part) => part.type === "stream-start").length).toBe(1)
  expect(parts.at(-1)).toMatchObject({ type: "text-delta", delta: "ready" })
})

test("Cursor never retries after text or tool calls", async () => {
  for (const part of [
    { type: "text-delta", id: "text", delta: "started" },
    { type: "tool-call", toolCallId: "call", toolName: "write", input: "{}" },
  ] satisfies LanguageModelV3StreamPart[]) {
    const { model, requests } = fixture([part])
    await expect(
      Array.fromAsync(cursorModelStream(model, { prompt: [] }))
    ).rejects.toThrow("Max Mode Required")
    expect(requests.length).toBe(1)
  }
})

test("Cursor does not retry unrelated request failures", async () => {
  const { model, requests } = fixture()
  model.doStream = async (options) => {
    requests.push(options)
    throw new CursorServerError("Different failure", {
      code: "invalid_argument",
      transient: false,
      replaySafe: true,
    })
  }
  await expect(
    Array.fromAsync(cursorModelStream(model, { prompt: [] }))
  ).rejects.toThrow("Different failure")
  expect(requests.length).toBe(1)
})
