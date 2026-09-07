import { useServerFn } from "@tanstack/react-start"
import { useEffect, useMemo, useSyncExternalStore } from "react"
import {
  getWorkspace,
  getWorkspaceActivity,
  getWorkspaceChecks,
  getWorkspaceMessages,
} from "@/functions/workspaces"
import { WorkspaceSocket } from "@/lib/workspace-socket"
import {
  createWorkspaceSynchronization,
  type WorkspaceSnapshot,
} from "./workspace-synchronization"

export const useWorkspaceSynchronization = (initial: WorkspaceSnapshot) => {
  const readWorkspace = useServerFn(getWorkspace)
  const readRuntime = useServerFn(getWorkspaceActivity)
  const readChecks = useServerFn(getWorkspaceChecks)
  const readMessages = useServerFn(getWorkspaceMessages)
  const synchronization = useMemo(
    () =>
      createWorkspaceSynchronization(initial, {
        workspace: (workspaceId) =>
          readWorkspace({ data: { workspaceId, includeOptions: false } }),
        runtime: (workspaceId) => readRuntime({ data: { workspaceId } }),
        checks: (workspaceId) => readChecks({ data: { workspaceId } }),
        messages: (workspaceId, cursor) =>
          readMessages({ data: { workspaceId, cursor } }),
        socket: (options) => new WorkspaceSocket(options),
      }),
    [initial.workspace.id, readWorkspace, readRuntime, readChecks, readMessages]
  )
  useEffect(() => synchronization.replace(initial), [initial, synchronization])
  useEffect(() => {
    synchronization.start()
    window.addEventListener("pagehide", synchronization.pause)
    window.addEventListener("pageshow", synchronization.resume)
    return () => {
      window.removeEventListener("pagehide", synchronization.pause)
      window.removeEventListener("pageshow", synchronization.resume)
      synchronization.stop()
    }
  }, [synchronization])
  const state = useSyncExternalStore(
    synchronization.subscribe,
    synchronization.getSnapshot,
    synchronization.getSnapshot
  )
  return {
    ...state,
    refresh: synchronization.refresh,
    dismissPermissionRequest: synchronization.dismissPermissionRequest,
    trackPrompt: synchronization.trackPrompt,
    history: {
      ...state.history,
      loadOlder: synchronization.loadOlder,
      showLatest: synchronization.showLatest,
    },
  }
}
