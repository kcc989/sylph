import { expect, test } from "bun:test"
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import { cursorToolNames } from "./tool-names"

const shell = {
  type: "function",
  name: "shell",
  inputSchema: { type: "object", required: ["command"] },
} as const

test("native Cursor shell calls and results preserve OpenCode tool identity", () => {
  const options: LanguageModelV3CallOptions = {
    tools: [shell],
    toolChoice: { type: "tool", toolName: "shell" },
    prompt: [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "shell",
            input: { command: "pwd" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "shell",
            output: { type: "text", value: "/workspace" },
          },
        ],
      },
    ],
  }
  const mapped = cursorToolNames(options)
  expect(mapped.options.tools).toEqual([{ ...shell, name: "bash" }])
  expect(mapped.options.toolChoice).toEqual({ type: "tool", toolName: "bash" })
  for (const message of mapped.options.prompt)
    expect(message.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolCallId: "call-1", toolName: "bash" }),
      ])
    )
  expect(
    mapped.output({
      type: "tool-call",
      toolCallId: "call-2",
      toolName: "bash",
      input: '{"command":"pwd"}',
    })
  ).toEqual({
    type: "tool-call",
    toolCallId: "call-2",
    toolName: "shell",
    input: '{"command":"pwd"}',
  })
  expect(
    mapped.output({ type: "tool-input-start", id: "call-2", toolName: "bash" })
  ).toEqual({ type: "tool-input-start", id: "call-2", toolName: "shell" })
  expect(options.tools).toEqual([shell])
})

test("tool aliasing does not introduce unavailable tools or replace an existing bash tool", () => {
  for (const tools of [
    undefined,
    [],
    [{ ...shell, name: "read" }],
    [shell, { ...shell, name: "bash" }],
  ]) {
    const options: LanguageModelV3CallOptions = { prompt: [], tools }
    const mapped = cursorToolNames(options)
    expect(mapped.options).toBe(options)
    const part = {
      type: "tool-call",
      toolCallId: "call",
      toolName: "bash",
      input: "{}",
    } as const
    expect(mapped.output(part)).toBe(part)
  }
})
