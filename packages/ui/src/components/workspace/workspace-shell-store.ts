import { Store } from "@tanstack/react-store"

import {
  readWorkspaceToolState,
  writeWorkspaceToolState,
  type WorkspaceToolState,
  type WorkspaceToolTabKind,
} from "@workspace/ui/lib/workspace-tool-state"

export type WorkspaceShellStorage = Pick<Storage, "getItem" | "setItem">

const emptyState: WorkspaceToolState = {
  tabs: [],
  activeTabId: null,
  toolPaneOpen: false,
  toolPaneSize: 50,
}

export const createWorkspaceShellStore = (
  workspaceId: string,
  storage: WorkspaceShellStorage | null = null
) =>
  new Store<WorkspaceToolState>(
    storage
      ? (readWorkspaceToolState(storage, workspaceId) ?? emptyState)
      : emptyState
  )

const tabLabel = {
  changes: "Changes",
  checks: "Checks",
  review: "Review",
  terminal: "Terminal",
  files: "Files",
  deployments: "Deployments",
} satisfies Record<Exclude<WorkspaceToolTabKind, "browser">, string>

const nextBrowserTab = (state: WorkspaceToolState) => {
  const number =
    state.tabs.reduce((highest, tab) => {
      const match = /^browser-(\d+)$/.exec(tab.id)
      return match ? Math.max(highest, Number(match[1])) : highest
    }, 0) + 1
  return {
    id: `browser-${number}`,
    kind: "browser" as const,
    label: number === 1 ? "Browser" : `Browser ${number}`,
  }
}

export const openWorkspaceTool = (
  store: Store<WorkspaceToolState>,
  kind: WorkspaceToolTabKind
) => {
  store.setState((state) => {
    if (kind === "browser") {
      const tab = nextBrowserTab(state)
      return {
        ...state,
        activeTabId: tab.id,
        tabs: [...state.tabs, tab],
        toolPaneOpen: true,
      }
    }

    const existing = state.tabs.find((tab) => tab.kind === kind)
    if (existing) {
      return { ...state, activeTabId: existing.id, toolPaneOpen: true }
    }

    const tab = { id: kind, kind, label: tabLabel[kind] }
    return {
      ...state,
      activeTabId: tab.id,
      tabs: [...state.tabs, tab],
      toolPaneOpen: true,
    }
  })
}

export const closeWorkspaceTool = (
  store: Store<WorkspaceToolState>,
  tabId: string
) => {
  store.setState((state) => {
    const index = state.tabs.findIndex((tab) => tab.id === tabId)
    const tabs = state.tabs.filter((tab) => tab.id !== tabId)
    return {
      ...state,
      activeTabId:
        state.activeTabId === tabId
          ? (tabs[Math.max(0, index - 1)]?.id ?? null)
          : state.activeTabId,
      tabs,
    }
  })
}

export const activateWorkspaceTool = (
  store: Store<WorkspaceToolState>,
  activeTabId: string
) => store.setState((state) => ({ ...state, activeTabId }))

export const setWorkspaceToolPaneOpen = (
  store: Store<WorkspaceToolState>,
  toolPaneOpen: boolean
) => store.setState((state) => ({ ...state, toolPaneOpen }))

export const setWorkspaceToolPaneSize = (
  store: Store<WorkspaceToolState>,
  toolPaneSize: number
) => store.setState((state) => ({ ...state, toolPaneSize }))

export const persistWorkspaceShellStore = (
  store: Store<WorkspaceToolState>,
  workspaceId: string,
  storage: WorkspaceShellStorage
) =>
  store.subscribe((state) =>
    writeWorkspaceToolState(storage, workspaceId, state)
  )
