import { describe, expect, test } from "bun:test"

import { workspaceRuntimeMessages } from "./workspace-runtime-messages"

describe("Workspace runtime messages", () => {
  test("excludes assistant reasoning from visible chat text", () => {
    expect(
      workspaceRuntimeMessages([
        {
          id: "assistant-1",
          type: "assistant",
          time: { created: 1 },
          content: [
            { type: "reasoning", text: "Private reasoning" },
            { type: "text", text: "Visible answer" },
          ],
        },
      ])
    ).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        text: "Visible answer",
        createdAt: 1,
        tools: [],
        error: null,
      },
    ])
  })

  test("keeps tool activity without exposing reasoning", () => {
    expect(
      workspaceRuntimeMessages([
        {
          id: "assistant-1",
          type: "assistant",
          time: { created: 1 },
          content: [
            { type: "reasoning", text: "Private reasoning" },
            { type: "tool", name: "read" },
          ],
        },
      ])
    ).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        text: "Used read",
        createdAt: 1,
        tools: ["read"],
        error: null,
      },
    ])
  })
})
