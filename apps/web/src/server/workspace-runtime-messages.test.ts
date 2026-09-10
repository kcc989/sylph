import { describe, expect, test } from "bun:test"
import { toolCallEntry } from "../lib/tool-call-entries"

import {
  workspaceRuntimeMessages,
  workspaceToolOutputLimit,
} from "./workspace-runtime-messages"

type CompletedToolOverrides = Partial<{
  input: object
  content: ReadonlyArray<
    | { type: "text"; text: string }
    | { type: "file"; uri: string; mime: string; name?: string | null }
  >
}>

const completedTool = (overrides: CompletedToolOverrides = {}) => ({
  type: "tool" as const,
  id: "tool-1",
  name: "workspace_read_file",
  state: {
    status: "completed" as const,
    input: { path: "src/app.tsx" },
    content: [{ type: "text" as const, text: "file contents" }],
    ...overrides,
  },
})

describe("workspaceRuntimeMessages", () => {
  test("preserves browser evidence links when accessibility output exceeds the message limit", () => {
    const evidence = [
      {
        id: "screenshot-1",
        kind: "screenshot",
        label: "Preview",
        url: "/api/evidence/screenshot-1",
        createdAt: 1,
      },
    ]
    const messages = workspaceRuntimeMessages([
      {
        id: "browser-1",
        type: "assistant",
        time: { created: 1 },
        content: [
          {
            ...completedTool({
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    url: "https://preview.example.com",
                    checkId: "check-1",
                    evidence,
                    accessibility: "x".repeat(24_000),
                    outcome: "observed",
                  }),
                },
                { type: "text", text: "Verified marker" },
              ],
            }),
            name: "workspace_browser",
          },
        ],
      },
    ])
    const part = messages[0]?.parts[0]
    if (part?.type !== "tool") throw new Error("Expected browser tool output")
    expect(part.output.length).toBeLessThanOrEqual(workspaceToolOutputLimit)
    expect(part.outputTruncated).toBeTrue()
    const detail = toolCallEntry(part).detail
    expect(detail?.kind).toBe("browser")
    if (detail?.kind !== "browser") throw new Error("Expected browser evidence")
    expect(detail.evidence[0]?.url).toBe("/api/evidence/screenshot-1")
    expect(detail.markdown).toBe("Verified marker")
  })

  test("shows failed native compaction without exposing its internal context", () => {
    expect(
      workspaceRuntimeMessages([
        {
          id: "compact-1",
          type: "compaction",
          time: { created: 1 },
          error: { message: "Provider rejected the request" },
        },
        { id: "compact-2", type: "compaction", time: { created: 2 } },
      ])
    ).toEqual([
      {
        id: "compact-1",
        role: "assistant",
        createdAt: 1,
        parts: [],
        error:
          "Could not shorten conversation context: Provider rejected the request",
      },
    ])
  })
  test("preserves text and tool ordering", () => {
    const messages = workspaceRuntimeMessages([
      {
        id: "assistant-1",
        type: "assistant",
        time: { created: 1 },
        content: [
          { type: "text", text: "Before" },
          completedTool(),
          { type: "text", text: "After" },
        ],
      },
    ])

    expect(messages[0]?.parts.map((part) => part.type)).toEqual([
      "text",
      "tool",
      "text",
    ])
    expect(messages[0]?.parts[0]).toEqual({ type: "text", text: "Before" })
    expect(messages[0]?.parts[2]).toEqual({ type: "text", text: "After" })
  })

  test("merges adjacent text, excludes reasoning, and stops at tools", () => {
    const messages = workspaceRuntimeMessages([
      {
        id: "assistant-1",
        type: "assistant",
        time: { created: 1 },
        content: [
          { type: "text", text: "First" },
          { type: "reasoning", text: "Private reasoning" },
          { type: "text", text: "Second" },
          completedTool(),
          { type: "text", text: "Third" },
          { type: "reasoning", text: "More private reasoning" },
          { type: "text", text: "Fourth" },
        ],
      },
    ])

    expect(messages[0]?.parts).toEqual([
      { type: "text", text: "First\n\nSecond" },
      {
        type: "tool",
        id: "tool-1",
        name: "workspace_read_file",
        status: "completed",
        input: { path: "src/app.tsx" },
        output: "file contents",
        outputTruncated: false,
        files: [],
        error: null,
      },
      { type: "text", text: "Third\n\nFourth" },
    ])
  })

  test("maps every runtime tool state", () => {
    const messages = workspaceRuntimeMessages([
      {
        id: "assistant-1",
        type: "assistant",
        time: { created: 1 },
        content: [
          {
            type: "tool",
            id: "streaming",
            name: "shell",
            state: { status: "streaming", input: "partial" },
          },
          {
            type: "tool",
            id: "running",
            name: "shell",
            state: {
              status: "running",
              input: { command: "bun test" },
              metadata: {},
            },
          },
          {
            type: "tool",
            id: "completed",
            name: "shell",
            state: {
              status: "completed",
              input: { command: "bun test" },
              content: [
                { type: "text", text: "one" },
                { type: "text", text: "two" },
              ],
            },
          },
          {
            type: "tool",
            id: "error",
            name: "shell",
            state: {
              status: "error",
              input: { command: "bun test" },
              error: { type: "command", message: "Tests failed" },
              content: [{ type: "text", text: "failure output" }],
            },
          },
        ],
      },
    ])
    const parts = messages[0]?.parts

    expect(parts?.map((part) => part.type === "tool" && part.status)).toEqual([
      "running",
      "running",
      "completed",
      "error",
    ])
    expect(parts?.[0]).toMatchObject({ input: {}, output: "", error: null })
    expect(parts?.[1]).toMatchObject({ input: { command: "bun test" } })
    expect(parts?.[2]).toMatchObject({ output: "one\ntwo", error: null })
    expect(parts?.[3]).toMatchObject({
      output: "failure output",
      error: "Tests failed",
    })
  })

  test("caps tool output", () => {
    const output = "x".repeat(workspaceToolOutputLimit + 20)
    const messages = workspaceRuntimeMessages([
      {
        id: "assistant-1",
        type: "assistant",
        time: { created: 1 },
        content: [completedTool({ content: [{ type: "text", text: output }] })],
      },
    ])
    const part = messages[0]?.parts[0]

    expect(part?.type).toBe("tool")
    if (part?.type !== "tool") throw new Error("Expected a tool part")
    expect(part.output).toHaveLength(workspaceToolOutputLimit)
    expect(part.outputTruncated).toBe(true)
  })

  test("passes file items separately from text output", () => {
    const messages = workspaceRuntimeMessages([
      {
        id: "assistant-1",
        type: "assistant",
        time: { created: 1 },
        content: [
          completedTool({
            content: [
              { type: "text", text: "summary" },
              {
                type: "file",
                uri: "file:///workspace/report.txt",
                mime: "text/plain",
                name: "report.txt",
              },
            ],
          }),
        ],
      },
    ])
    const part = messages[0]?.parts[0]

    expect(part?.type).toBe("tool")
    if (part?.type !== "tool") throw new Error("Expected a tool part")
    expect(part.output).toBe("summary")
    expect(part.files).toEqual([
      {
        uri: "file:///workspace/report.txt",
        mime: "text/plain",
        name: "report.txt",
      },
    ])
  })

  test("maps user text to one part", () => {
    expect(
      workspaceRuntimeMessages([
        {
          id: "user-1",
          type: "user",
          time: { created: 1 },
          text: "Build the feature",
        },
      ])[0]
    ).toEqual({
      id: "user-1",
      role: "user",
      createdAt: 1,
      parts: [{ type: "text", text: "Build the feature" }],
      error: null,
    })
  })
})

test("shows successful compaction using the original request identity", () => {
  const messages = workspaceRuntimeMessages([
    {
      id: "compact-request",
      type: "compaction",
      status: "completed",
      time: { created: 1, completed: 2 },
    },
  ])
  expect(messages).toEqual([
    {
      id: "compact-request",
      role: "assistant",
      createdAt: 1,
      parts: [
        {
          type: "text",
          text: "Conversation context shortened. Earlier messages and files are preserved.",
        },
      ],
      error: null,
    },
  ])
})
