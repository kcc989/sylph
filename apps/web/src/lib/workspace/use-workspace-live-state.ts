import {
  workspaceRefreshScope,
  type WorkspaceRefreshScope,
} from "./workspace-refresh"
import type { WorkspacePresenceUser } from "@workspace/ui/components/workspace/types"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  applyWorkspaceRuntimeEvent,
  emptyWorkspaceLiveState,
  type WorkspaceLiveState,
} from "@/lib/workspace-runtime-events"
import { WorkspaceSocket } from "@/lib/workspace-socket"

export const useWorkspaceLiveState = (
  workspaceId: string,
  sessionId: string | null,
  initialCursor: number | null,
  refreshSnapshot: (scope: WorkspaceRefreshScope) => void
) => {
  const [state, setState] = useState(emptyWorkspaceLiveState)
  const [presence, setPresence] = useState<
    ReadonlyArray<WorkspacePresenceUser>
  >([])
  const stateRef = useRef(state)
  const socketCursor = useRef({ workspaceId, cursor: initialCursor })
  if (socketCursor.current.workspaceId !== workspaceId) {
    socketCursor.current = { workspaceId, cursor: initialCursor }
  }

  useEffect(() => {
    stateRef.current = emptyWorkspaceLiveState()
    setState(stateRef.current)
    setPresence([])
    if (!sessionId) return
    let disposed = false
    const socket = new WorkspaceSocket({
      workspaceId,
      sessionId,
      cursor: socketCursor.current.cursor,
      onConnecting: () => {
        stateRef.current = emptyWorkspaceLiveState()
        setState(stateRef.current)
      },
      onEvent: async (event) => {
        const next = await applyWorkspaceRuntimeEvent(stateRef.current, event)
        if (disposed) return
        stateRef.current = next
        setState(next)
        const scope = workspaceRefreshScope(event.type)
        if (scope) refreshSnapshot(scope)
      },
      onSynced: (cursor) => {
        if (disposed) return
        socketCursor.current.cursor = cursor
        refreshSnapshot("workspace")
      },
      onPresence: setPresence,
    })
    const pause = () => socket.pause()
    const resume = () => socket.resume()
    window.addEventListener("pagehide", pause)
    window.addEventListener("pageshow", resume)
    socket.connect()

    return () => {
      disposed = true
      window.removeEventListener("pagehide", pause)
      window.removeEventListener("pageshow", resume)
      socket.close()
    }
  }, [refreshSnapshot, sessionId, workspaceId])

  const dismissPermissionRequest = useCallback((requestId: string) => {
    setState((current) => {
      const permissionRequests = { ...current.permissionRequests }
      delete permissionRequests[requestId]
      const next: WorkspaceLiveState = { ...current, permissionRequests }
      stateRef.current = next
      return next
    })
  }, [])

  return { dismissPermissionRequest, presence, state }
}
