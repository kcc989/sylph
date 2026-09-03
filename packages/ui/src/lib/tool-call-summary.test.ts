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
  const tool = (id: string, status: "running" | "completed" | "error") => ({
    id,
    kind: "tool",
    tool: { status },
  })

  test("folds runs longer than five", () => {
    const entries = Array.from({ length: 6 }, (_, index) =>
      tool(`tool-${index}`, "completed")
    )
    const grouped = groupToolCalls(entries)

    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toMatchObject({ kind: "tool-group" })
    expect("entries" in grouped[0] ? grouped[0].entries : []).toHaveLength(6)
  })

  test("keeps short runs and active tools visible", () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, index) =>
        tool(`tool-${index}`, "completed")
      ),
      tool("active", "running"),
      tool("done", "completed"),
    ]

    expect(groupToolCalls(entries)).toEqual(entries)
  })

  test("does not group across text entries", () => {
    const entries = [
      ...Array.from({ length: 4 }, (_, index) =>
        tool(`before-${index}`, "completed")
      ),
      { id: "text", kind: "agent" },
      ...Array.from({ length: 4 }, (_, index) =>
        tool(`after-${index}`, "completed")
      ),
    ]

    expect(groupToolCalls(entries)).toEqual(entries)
  })
})
