import { describe, expect, test } from "bun:test"

import {
  closeWorkspaceTool,
  createWorkspaceShellStore,
  openWorkspaceTool,
  setWorkspaceToolPaneOpen,
} from "./workspace-shell-store"

describe("Workspace shell store", () => {
  test("opens one tab for each reusable tool", () => {
    const store = createWorkspaceShellStore("workspace-1")

    openWorkspaceTool(store, "checks")
    openWorkspaceTool(store, "checks")

    expect(store.state.tabs).toEqual([
      { id: "checks", kind: "checks", label: "Checks" },
    ])
    expect(store.state.activeTabId).toBe("checks")
    expect(store.state.toolPaneOpen).toBe(true)
  })

  test("opens a distinct Browser tab each time", () => {
    const store = createWorkspaceShellStore("workspace-1")

    openWorkspaceTool(store, "browser")
    openWorkspaceTool(store, "browser")

    expect(store.state.tabs.map((tab) => tab.label)).toEqual([
      "Browser",
      "Browser 2",
    ])
  })

  test("activates a neighboring tab after closing the active tab", () => {
    const store = createWorkspaceShellStore("workspace-1")
    openWorkspaceTool(store, "checks")
    openWorkspaceTool(store, "review")

    closeWorkspaceTool(store, "review")

    expect(store.state.activeTabId).toBe("checks")
  })

  test("can hide the tool pane without removing tabs", () => {
    const store = createWorkspaceShellStore("workspace-1")
    openWorkspaceTool(store, "terminal")

    setWorkspaceToolPaneOpen(store, false)

    expect(store.state.toolPaneOpen).toBe(false)
    expect(store.state.tabs).toHaveLength(1)
  })
})
