"use client"

import { useStore, type Store } from "@tanstack/react-store"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
} from "react"

import type { WorkspaceToolState } from "@workspace/ui/lib/workspace-tool-state"

import {
  createWorkspaceShellStore,
  persistWorkspaceShellStore,
  type WorkspaceShellStorage,
} from "./workspace-shell-store"

const WorkspaceShellContext = createContext<Store<WorkspaceToolState> | null>(
  null
)

const browserStorage = (): WorkspaceShellStorage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function WorkspaceShellProvider({
  children,
  workspaceId,
}: {
  children: ReactNode
  workspaceId: string
}) {
  const store = useMemo(
    () => createWorkspaceShellStore(workspaceId, browserStorage()),
    [workspaceId]
  )

  useEffect(() => {
    const storage = browserStorage()
    return storage
      ? persistWorkspaceShellStore(store, workspaceId, storage).unsubscribe
      : undefined
  }, [store, workspaceId])

  return <WorkspaceShellContext value={store}>{children}</WorkspaceShellContext>
}

export const useWorkspaceShellStore = () => {
  const store = useContext(WorkspaceShellContext)
  if (!store) {
    throw new Error(
      "useWorkspaceShellStore must be used within WorkspaceShellProvider"
    )
  }
  return store
}

export const useWorkspaceShell = <T,>(
  selector: (state: WorkspaceToolState) => T
) => useStore(useWorkspaceShellStore(), selector)
