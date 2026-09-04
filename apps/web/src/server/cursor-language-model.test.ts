import { expect, test } from "bun:test"
import type { LanguageModelV3ToolCall } from "@ai-sdk/provider"
import { Schema } from "effect"
import { CursorRuntimeRequest } from "@workspace/domain/cursor-provider"
import {
  cursorLanguageModel,
  cursorResponseStream,
} from "./cursor-language-model"

const finish = {
  type: "finish",
  finishReason: { unified: "tool-calls" },
  usage: { inputTokens: {}, outputTokens: {} },
}
const response = (parts: object[]) =>
  new Response(parts.map((part) => JSON.stringify(part)).join("\n") + "\n")

test("Cursor streams preserve Sylph tool calls and finish reasons", async () => {
  const call: LanguageModelV3ToolCall = {
    type: "tool-call",
    toolCallId: "cursor_session_7",
    toolName: "workspace_checkpoint",
    input: '{"message":"Save changes"}',
  }
  const parts = await Array.fromAsync(
    cursorResponseStream(response([call, finish]))
  )
  expect(parts[0]).toEqual(call)
  expect(parts[1]).toMatchObject(finish)
})

test("Cursor rejects a truncated response instead of reporting completion", async () => {
  await expect(
    Array.fromAsync(
      cursorResponseStream(
        response([{ type: "text-delta", id: "1", delta: "Partial" }])
      )
    )
  ).rejects.toThrow("ended before completion")
})

test("Cursor rejects removed connections", () => {
  expect(() =>
    cursorResponseStream(new Response(null, { status: 401 }))
  ).toThrow("401")
})

test("Cursor decodes events split across network chunks", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(finish) + "\n")
  const body = new ReadableStream({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  })
  const parts = await Array.fromAsync(cursorResponseStream(new Response(body)))
  expect(parts).toHaveLength(1)
})

test("Cursor exposes provider errors as failures", async () => {
  await expect(
    Array.fromAsync(
      cursorResponseStream(
        response([{ type: "error", error: "Reconnect Cursor" }])
      )
    )
  ).rejects.toThrow("Reconnect Cursor")
})

test("Cursor model calls keep user identity, tool results, and cancellation", async () => {
  const controller = new AbortController()
  const model = cursorLanguageModel(
    "cursor-model",
    async () => JSON.stringify({ userId: "user-a", key: "connection-a" }),
    async (userId, request) => {
      expect(userId).toBe("user-a")
      const payload = await Schema.decodeUnknownPromise(CursorRuntimeRequest)(
        await request.json()
      )
      expect(payload.key).toBe("connection-a")
      if (payload.operation !== "stream")
        throw new Error("Expected model stream")
      expect(payload.call.sessionId).toBe("workspace-session")
      expect(payload.call.options.prompt[0]).toMatchObject({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "cursor_session_7",
            toolName: "workspace_checkpoint",
            output: { type: "text", value: "commit-123" },
          },
        ],
      })
      expect(payload.call.options.providerOptions?.cursor).toMatchObject({
        opencodeCompaction: true,
      })
      controller.abort()
      expect(request.signal.aborted).toBe(true)
      return response([finish])
    }
  )
  const result = await model.doStream({
    prompt: [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "cursor_session_7",
            toolName: "workspace_checkpoint",
            output: { type: "text", value: "commit-123" },
          },
        ],
      },
    ],
    headers: {
      "x-opencode-session": "workspace-session",
      "x-sylph-cursor-compaction": "true",
    },
    abortSignal: controller.signal,
  })
  await Array.fromAsync(result.stream)
})

test("Cursor refuses a model call without a durable session identity", async () => {
  let called = false
  const model = cursorLanguageModel(
    "model",
    async () => JSON.stringify({ userId: "a", key: "b" }),
    async () => {
      called = true
      return response([finish])
    }
  )
  await expect(model.doStream({ prompt: [] })).rejects.toThrow(
    "session identity"
  )
  expect(called).toBe(false)
})
