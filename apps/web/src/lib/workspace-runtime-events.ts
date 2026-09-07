import {
  type WorkspaceRuntimeEvent,
  workspaceEventRefreshScope,
  WorkspacePermissionAskedEventData,
  WorkspacePermissionRepliedEventData,
  WorkspaceTextDeltaEventData,
  WorkspaceTextEndedEventData,
} from "@workspace/domain"
import { Schema } from "effect"

const decodeWorkspacePermissionAskedEventDataPromise =
  Schema.decodeUnknownPromise(WorkspacePermissionAskedEventData)
const decodeWorkspacePermissionRepliedEventDataPromise =
  Schema.decodeUnknownPromise(WorkspacePermissionRepliedEventData)
const decodeWorkspaceTextDeltaEventDataPromise = Schema.decodeUnknownPromise(
  WorkspaceTextDeltaEventData
)
const decodeWorkspaceTextEndedEventDataPromise = Schema.decodeUnknownPromise(
  WorkspaceTextEndedEventData
)

export type WorkspaceLiveState = {
  partialMessages: Record<string, string>
  permissionRequests: Record<string, WorkspacePermissionAskedEventData>
  dismissedPermissionRequests: ReadonlyArray<string>
}

export const emptyWorkspaceLiveState = (): WorkspaceLiveState => ({
  partialMessages: {},
  permissionRequests: {},
  dismissedPermissionRequests: [],
})

export const applyWorkspaceRuntimeEvent = async (
  state: WorkspaceLiveState,
  event: WorkspaceRuntimeEvent
): Promise<WorkspaceLiveState> => {
  if (event.type === "permission.asked") {
    const data = await decodeWorkspacePermissionAskedEventDataPromise(
      event.data
    )

    return {
      ...state,
      permissionRequests: {
        ...state.permissionRequests,
        [data.id]: data,
      },
    }
  }

  if (event.type === "permission.replied") {
    const data = await decodeWorkspacePermissionRepliedEventDataPromise(
      event.data
    )
    return dismissWorkspacePermission(state, data.requestID)
  }

  if (event.type === "session.text.delta") {
    const data = await decodeWorkspaceTextDeltaEventDataPromise(event.data)
    return {
      ...state,
      partialMessages: {
        ...state.partialMessages,
        [data.assistantMessageID]: `${state.partialMessages[data.assistantMessageID] ?? ""}${data.delta}`,
      },
    }
  }

  if (event.type === "session.text.ended") {
    const data = await decodeWorkspaceTextEndedEventDataPromise(event.data)
    return {
      ...state,
      partialMessages: {
        ...state.partialMessages,
        [data.assistantMessageID]: data.text,
      },
    }
  }

  return state
}

export const workspaceEventNeedsSnapshot = (event: WorkspaceRuntimeEvent) =>
  workspaceEventRefreshScope(event.type) !== null

export const dismissWorkspacePermission = (
  state: WorkspaceLiveState,
  requestId: string
): WorkspaceLiveState => {
  const permissionRequests = { ...state.permissionRequests }
  delete permissionRequests[requestId]
  return {
    ...state,
    permissionRequests,
    dismissedPermissionRequests: [
      ...new Set([...state.dismissedPermissionRequests, requestId]),
    ],
  }
}
