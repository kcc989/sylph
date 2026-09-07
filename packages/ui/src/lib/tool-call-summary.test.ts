import { describe, expect, test } from "bun:test"

import {
  groupToolCalls,
  toolCallFamily,
  toolCallLabel,
} from "./tool-call-summary"

describe("toolCallLabel", () => {
  test("summarizes Workspace file and browser calls", () => {
    expect(
      toolCallLabel({
        name: "workspace_read_file",
        input: { path: "src/app.tsx" },
      })
    ).toBe("Read src/app.tsx")
    expect(
      toolCallLabel({
        name: "workspace_list_files",
        input: { directory: "src" },
      })
    ).toBe("Listed files in src")
    expect(
      toolCallLabel({
        name: "workspace_browser",
        input: { path: "/login" },
      })
    ).toBe("Opened /login in the Preview")
  })

  test("summarizes checks, diffs, checkpoints, and generic calls", () => {
    expect(
      toolCallLabel({
        name: "workspace_diff",
        input: { scope: "checkpoint" },
      })
    ).toBe("Diff since base commit")
    expect(
      toolCallLabel({
        name: "workspace_checkpoint",
        input: { message: "Add transcript tools" },
      })
    ).toBe("Checkpoint: Add transcript tools")
    expect(toolCallLabel({ name: "web_search", input: {} })).toBe("web search")
    expect(toolCallFamily("workspace_run_checks")).toBe("checks")
  })
})

describe("groupToolCalls", () => {
  const tool = (
    id: string,
    name = "read",
    status: "running" | "completed" | "error" = "completed"
  ) => ({
    id,
    kind: "tool",
    tool: { name, input: { path: "src/app.tsx" }, status },
  })

  test("summarizes related calls without losing their order or payloads", () => {
    const entries = [
      tool("1"),
      tool("2", "grep"),
      tool("3", "write"),
      tool("4", "edit"),
      tool("5", "shell"),
      tool("6", "shell"),
    ]
    expect(groupToolCalls(entries)).toEqual([
      {
        id: "tool-group:1",
        kind: "tool-group",
        summary: "Inspected workspace · 1 read, 1 search",
        entries: entries.slice(0, 2),
      },
      {
        id: "tool-group:3",
        kind: "tool-group",
        summary: "Made 2 file changes",
        entries: entries.slice(2, 4),
      },
      {
        id: "tool-group:5",
        kind: "tool-group",
        summary: "Ran 2 commands",
        entries: entries.slice(4, 6),
      },
    ])
  })

  test("keeps failures, running calls, and distinct actions visible", () => {
    const entries = [
      tool("1"),
      tool("2", "read", "error"),
      tool("3", "read", "running"),
      tool("4", "write"),
      tool("5", "shell"),
      tool("6", "workspace_checkpoint"),
      tool("7", "workspace_checkpoint"),
    ]
    expect(groupToolCalls(entries)).toEqual(entries)
  })

  test("preserves text boundaries and group identity as calls complete", () => {
    const entries = [
      tool("1"),
      tool("2"),
      { id: "text", kind: "agent" },
      tool("3"),
      tool("4"),
    ]
    const groups = groupToolCalls(entries)
    expect(groups).toHaveLength(3)
    expect(groups[1]).toEqual(entries[2])
    expect(groups[0]?.id).toBe(
      groupToolCalls([tool("1"), tool("2"), tool("3")])[0]?.id
    )
  })

  test("counts repeated reads as reads, not unique files", () => {
    expect(groupToolCalls([tool("1"), tool("2")])[0]).toMatchObject({
      summary: "Inspected files · 2 reads",
    })
  })

  test("names native calls in expanded details", () => {
    expect(
      toolCallLabel({ name: "read", input: { filePath: "src/app.tsx" } })
    ).toBe("Read src/app.tsx")
    expect(
      toolCallLabel({ name: "write", input: { path: "src/app.tsx" } })
    ).toBe("Wrote src/app.tsx")
    expect(
      toolCallLabel({ name: "edit", input: { path: "src/app.tsx" } })
    ).toBe("Edited src/app.tsx")
    expect(toolCallLabel({ name: "shell", input: {} })).toBe("Ran command")
  })
})
