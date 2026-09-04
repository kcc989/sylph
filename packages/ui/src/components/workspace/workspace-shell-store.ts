import { Store } from "@tanstack/react-store"
import {
  readWorkspaceToolState,
  writeWorkspaceToolState,
  type WorkspaceToolState,
  type WorkspaceToolTabKind,
} from "@workspace/ui/lib/workspace-tool-state"

export type WorkspaceShellStorage = Pick<Storage, "getItem" | "setItem">
export type WorkspaceReference = { label: string; text: string }
export type WorkspaceShellState = WorkspaceToolState & {
  expanded: boolean
  mobileView: "conversation" | "inspect"
  activityId: string | null
  references: WorkspaceReference[]
}

const destinations = [
  { id: "browser", kind: "browser", label: "Preview" },
  { id: "changes", kind: "changes", label: "Changes" },
  { id: "files", kind: "files", label: "Files" },
] satisfies WorkspaceToolState["tabs"]

export const createWorkspaceShellStore = (
  workspaceId: string,
  storage: WorkspaceShellStorage | null = null
) => {
  const saved = storage ? readWorkspaceToolState(storage, workspaceId) : null
  const kind = saved?.tabs.find((tab) => tab.id === saved.activeTabId)?.kind
  return new Store<WorkspaceShellState>({
    ...saved,
    tabs: destinations,
    activeTabId:
      kind === "review"
        ? "changes"
        : kind === "terminal"
          ? "browser"
          : (kind ?? "browser"),
    toolPaneOpen: saved?.toolPaneOpen ?? true,
    toolPaneSize: saved?.toolPaneSize ?? 60,
    terminalOpen: saved?.terminalOpen ?? kind === "terminal",
    terminalSize: saved?.terminalSize ?? 28,
    changeScope:
      saved?.changeScope ?? (kind === "review" ? "branch" : "working"),
    expanded: false,
    mobileView: "conversation",
    activityId: null,
    references: [],
  })
}

export const openWorkspaceTool = (
  store: Store<WorkspaceShellState>,
  kind: WorkspaceToolTabKind
) =>
  store.setState((state) =>
    kind === "terminal"
      ? {
          ...state,
          terminalOpen: !state.terminalOpen,
        }
      : {
          ...state,
          activeTabId: kind === "review" ? "changes" : kind,
          changeScope: kind === "review" ? "branch" : state.changeScope,
          toolPaneOpen: true,
          mobileView: "inspect",
          activityId: null,
        }
  )

export const setWorkspaceToolPaneOpen = (
  store: Store<WorkspaceShellState>,
  toolPaneOpen: boolean
) =>
  store.setState((state) => ({
    ...state,
    toolPaneOpen,
    expanded: false,
    mobileView: toolPaneOpen ? "inspect" : "conversation",
  }))

export const setWorkspaceToolPaneSize = (
  store: Store<WorkspaceShellState>,
  toolPaneSize: number
) => store.setState((state) => ({ ...state, toolPaneSize }))

export const referenceWorkspaceContext = (
  store: Store<WorkspaceShellState>,
  reference: WorkspaceReference
) =>
  store.setState((state) => ({
    ...state,
    expanded: false,
    mobileView: "conversation",
    references: state.references.some((item) => item.text === reference.text)
      ? state.references
      : [...state.references, reference],
  }))

export const inspectWorkspaceActivity = (
  store: Store<WorkspaceShellState>,
  activityId: string
) =>
  store.setState((state) => ({
    ...state,
    activityId,
    activeTabId: "checks",
    toolPaneOpen: true,
    mobileView: "inspect",
  }))

export const persistWorkspaceShellStore = (
  store: Store<WorkspaceShellState>,
  workspaceId: string,
  storage: WorkspaceShellStorage
) =>
  store.subscribe((state) =>
    writeWorkspaceToolState(storage, workspaceId, {
      ...state,
      tabs: [
        ...destinations,
        { id: "checks", kind: "checks", label: "Checks" },
        { id: "deployments", kind: "deployments", label: "Deployments" },
      ],
    })
  )
