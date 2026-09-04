import { describe, expect, test } from "bun:test"
import {
  writeWorkspaceToolState,
  readWorkspaceToolState,
} from "@workspace/ui/lib/workspace-tool-state"
import {
  createWorkspaceShellStore,
  openWorkspaceTool,
  setWorkspaceToolPaneOpen,
  referenceWorkspaceContext,
  persistWorkspaceShellStore,
} from "./workspace-shell-store"

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
}

describe("Workspace companion layout", () => {
  test("keeps Preview, Changes and Files stable without duplicate browsers", () => {
    const store = createWorkspaceShellStore("workspace-1")
    openWorkspaceTool(store, "browser")
    openWorkspaceTool(store, "browser")
    expect(store.state.tabs.map((tab) => tab.label)).toEqual([
      "Preview",
      "Changes",
      "Files",
    ])
    expect(store.state.activeTabId).toBe("browser")
    expect(store.state.toolPaneOpen).toBe(true)
  })

  test("opens command output independently of the selected surface", () => {
    const store = createWorkspaceShellStore("workspace-1")
    openWorkspaceTool(store, "review")
    openWorkspaceTool(store, "terminal")
    expect(store.state.activeTabId).toBe("changes")
    expect(store.state.changeScope).toBe("branch")
    expect(store.state.terminalOpen).toBe(true)
    setWorkspaceToolPaneOpen(store, false)
    expect(store.state.terminalOpen).toBe(true)
    expect(store.state.mobileView).toBe("conversation")
  })

  test("migrates legacy review windows and preserves the split", () => {
    const storage = memoryStorage()
    writeWorkspaceToolState(storage, "workspace-1", {
      tabs: [{ id: "review", kind: "review", label: "Review" }],
      activeTabId: "review",
      toolPaneOpen: true,
      toolPaneSize: 62,
    })
    const store = createWorkspaceShellStore("workspace-1", storage)
    expect(store.state.activeTabId).toBe("changes")
    expect(store.state.changeScope).toBe("branch")
    expect(store.state.toolPaneSize).toBe(62)
  })

  test("references return to chat without changing the inspected surface or persisting context", () => {
    const storage = memoryStorage()
    const store = createWorkspaceShellStore("workspace-1", storage)
    const subscription = persistWorkspaceShellStore(
      store,
      "workspace-1",
      storage
    )
    openWorkspaceTool(store, "files")
    store.setState((state) => ({ ...state, expanded: true }))
    const reference = { label: "index.ts", text: "Workspace file: index.ts" }
    referenceWorkspaceContext(store, reference)
    referenceWorkspaceContext(store, reference)
    expect(store.state.references).toEqual([reference])
    expect(store.state.activeTabId).toBe("files")
    expect(store.state.expanded).toBe(false)
    expect(store.state.mobileView).toBe("conversation")
    expect(readWorkspaceToolState(storage, "workspace-1")).not.toHaveProperty(
      "references"
    )
    const restored = createWorkspaceShellStore("workspace-1", storage)
    expect(restored.state.references).toEqual([])
    expect(restored.state.activeTabId).toBe("files")
    subscription.unsubscribe()
  })
})
