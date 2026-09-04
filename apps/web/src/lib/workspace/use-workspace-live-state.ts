import type { WorkspacePresenceUser } from "@workspace/ui/components/workspace/types"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  applyWorkspaceRuntimeEvent,
  emptyWorkspaceLiveState,
  workspaceEventNeedsSnapshot,
  type WorkspaceLiveState,
} from "@/lib/workspace-runtime-events"
import { WorkspaceSocket } from "@/lib/workspace-socket"

export const useWorkspaceLiveState = (
  workspaceId: string,
  sessionId: string | null,
  initialCursor: number | null,
  refreshSnapshot: () => void
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
    let refreshTimer: number | null = null

    const scheduleRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(refreshSnapshot, 80)
    }

    const socket = new WorkspaceSocket({
      workspaceId,
      sessionId,
      cursor: socketCursor.current.cursor,
      onConnecting: () => {
        stateRef.current = emptyWorkspaceLiveState()
        setState(stateRef.current)
      },
      onEvent: async (event) => {
        stateRef.current = await applyWorkspaceRuntimeEvent(
          stateRef.current,
          event
        )
        setState(stateRef.current)
        if (workspaceEventNeedsSnapshot(event)) scheduleRefresh()
      },
      onSynced: (cursor) => {
        socketCursor.current.cursor = cursor
        scheduleRefresh()
      },
      onPresence: setPresence,
    })
    const pause = () => socket.pause()
    const resume = () => socket.resume()
    window.addEventListener("pagehide", pause)
    window.addEventListener("pageshow", resume)
    socket.connect()

    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
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
