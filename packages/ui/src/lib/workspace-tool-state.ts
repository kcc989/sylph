import { z } from "zod"

export const workspaceToolStateLimit = 25

const WorkspaceToolTabKindSchema = z.enum([
  "browser",
  "changes",
  "checks",
  "review",
  "terminal",
  "files",
  "deployments",
])

const WorkspaceToolTabSchema = z.object({
  id: z.string().min(1),
  kind: WorkspaceToolTabKindSchema,
  label: z.string().min(1),
})

const WorkspaceToolStateSchema = z.object({
  tabs: z.array(WorkspaceToolTabSchema),
  activeTabId: z.string().nullable(),
  toolPaneOpen: z.boolean(),
  toolPaneSize: z.number().finite().min(10).max(90),
  terminalOpen: z.boolean().optional(),
  terminalSize: z.number().finite().min(15).max(60).optional(),
  changeScope: z.enum(["working", "branch"]).optional(),
})

const WorkspaceToolStateEntrySchema = WorkspaceToolStateSchema.extend({
  workspaceId: z.string().min(1),
  updatedAt: z.number().finite(),
})

const WorkspaceToolStateStoreSchema = z.object({
  version: z.literal(1),
  workspaces: z.array(WorkspaceToolStateEntrySchema),
})

export type WorkspaceToolTabKind = z.infer<typeof WorkspaceToolTabKindSchema>
export type WorkspaceToolTab = z.infer<typeof WorkspaceToolTabSchema>
export type WorkspaceToolState = z.infer<typeof WorkspaceToolStateSchema>

type WorkspaceToolStateEntry = z.infer<typeof WorkspaceToolStateEntrySchema>
type WorkspaceToolStateStore = z.infer<typeof WorkspaceToolStateStoreSchema>
type WorkspaceToolStateStorage = Pick<Storage, "getItem" | "setItem">

const storageKey = "sylph.workspace-tool-state.v1"

const normalizeEntry = (
  entry: WorkspaceToolStateEntry
): WorkspaceToolStateEntry => {
  const tabs = Array.from(
    new Map(entry.tabs.map((tab) => [tab.id, tab] as const)).values()
  )
  const activeTabId = tabs.some((tab) => tab.id === entry.activeTabId)
    ? entry.activeTabId
    : (tabs[0]?.id ?? null)

  return { ...entry, tabs, activeTabId }
}

const readStore = (
  storage: WorkspaceToolStateStorage
): WorkspaceToolStateStore => {
  try {
    const decoded = WorkspaceToolStateStoreSchema.safeParse(
      JSON.parse(storage.getItem(storageKey) ?? "null")
    )
    if (!decoded.success) return { version: 1, workspaces: [] }

    return {
      version: 1,
      workspaces: decoded.data.workspaces.map(normalizeEntry),
    }
  } catch {
    return { version: 1, workspaces: [] }
  }
}

export const readWorkspaceToolState = (
  storage: WorkspaceToolStateStorage,
  workspaceId: string
): WorkspaceToolState | null => {
  const entry = readStore(storage).workspaces.find(
    (workspace) => workspace.workspaceId === workspaceId
  )
  if (!entry) return null

  const state: WorkspaceToolState = {
    tabs: entry.tabs,
    activeTabId: entry.activeTabId,
    toolPaneOpen: entry.toolPaneOpen,
    toolPaneSize: entry.toolPaneSize,
  }
  if (entry.terminalOpen !== undefined) state.terminalOpen = entry.terminalOpen
  if (entry.terminalSize !== undefined) state.terminalSize = entry.terminalSize
  if (entry.changeScope !== undefined) state.changeScope = entry.changeScope
  return state
}

export const writeWorkspaceToolState = (
  storage: WorkspaceToolStateStorage,
  workspaceId: string,
  state: WorkspaceToolState,
  updatedAt = Date.now(),
  limit = workspaceToolStateLimit
) => {
  const decoded = WorkspaceToolStateEntrySchema.safeParse({
    workspaceId,
    updatedAt,
    ...state,
  })
  if (!decoded.success) return

  const retained = readStore(storage).workspaces.filter(
    (workspace) => workspace.workspaceId !== workspaceId
  )
  const workspaces = [normalizeEntry(decoded.data), ...retained]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(1, Math.floor(limit)))

  try {
    storage.setItem(storageKey, JSON.stringify({ version: 1, workspaces }))
  } catch {
    return
  }
}
