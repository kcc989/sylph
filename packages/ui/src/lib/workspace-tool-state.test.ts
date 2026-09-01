import { describe, expect, test } from "bun:test"

import {
  readWorkspaceToolState,
  workspaceToolStateLimit,
  writeWorkspaceToolState,
  type WorkspaceToolState,
} from "@workspace/ui/lib/workspace-tool-state"

const state = (activeTabId: string): WorkspaceToolState => ({
  tabs: [{ id: activeTabId, kind: "terminal", label: "Terminal" }],
  activeTabId,
  toolPaneOpen: true,
  toolPaneSize: 42,
})

const storage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe("workspace tool state", () => {
  test("restores state for one workspace", () => {
    const localStorage = storage()

    writeWorkspaceToolState(localStorage, "workspace-a", state("terminal"), 1)

    expect(readWorkspaceToolState(localStorage, "workspace-a")).toEqual(
      state("terminal")
    )
    expect(readWorkspaceToolState(localStorage, "workspace-b")).toBeNull()
  })

  test("replaces the current workspace record", () => {
    const localStorage = storage()

    writeWorkspaceToolState(localStorage, "workspace-a", state("terminal"), 1)
    writeWorkspaceToolState(
      localStorage,
      "workspace-a",
      {
        tabs: [{ id: "changes", kind: "changes", label: "Changes" }],
        activeTabId: "changes",
        toolPaneOpen: false,
        toolPaneSize: 64,
      },
      2
    )

    expect(readWorkspaceToolState(localStorage, "workspace-a")).toEqual({
      tabs: [{ id: "changes", kind: "changes", label: "Changes" }],
      activeTabId: "changes",
      toolPaneOpen: false,
      toolPaneSize: 64,
    })
  })

  test("keeps only the 25 most recent workspaces", () => {
    const localStorage = storage()

    for (let index = 0; index <= workspaceToolStateLimit; index += 1) {
      writeWorkspaceToolState(
        localStorage,
        `workspace-${index}`,
        state("terminal"),
        index
      )
    }

    expect(readWorkspaceToolState(localStorage, "workspace-0")).toBeNull()
    expect(
      readWorkspaceToolState(
        localStorage,
        `workspace-${workspaceToolStateLimit}`
      )
    ).toEqual(state("terminal"))
  })

  test("ignores malformed storage", () => {
    const localStorage = storage()
    localStorage.setItem("sylph.workspace-tool-state.v1", "not-json")

    expect(readWorkspaceToolState(localStorage, "workspace-a")).toBeNull()
  })
})
