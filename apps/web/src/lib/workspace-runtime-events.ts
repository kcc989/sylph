import {
  type WorkspaceRuntimeEvent,
  WorkspacePermissionAskedEventData,
  WorkspacePermissionRepliedEventData,
  WorkspaceTextDeltaEventData,
  WorkspaceTextEndedEventData,
} from "@workspace/domain"
import type { WorkspacePermissionRequest } from "@workspace/ui/components/workspace-shell"
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
  permissionRequests: Record<string, WorkspacePermissionRequest>
}

export const emptyWorkspaceLiveState = (): WorkspaceLiveState => ({
  partialMessages: {},
  permissionRequests: {},
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
        [data.id]: {
          id: data.id,
          action: data.action,
          resources: [...data.resources],
          message: data.message,
          canSave: Boolean(data.save?.length),
        },
      },
    }
  }

  if (event.type === "permission.replied") {
    const data = await decodeWorkspacePermissionRepliedEventDataPromise(
      event.data
    )
    if (!state.permissionRequests[data.requestID]) return state
    const permissionRequests = { ...state.permissionRequests }
    delete permissionRequests[data.requestID]
    return { ...state, permissionRequests }
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
  event.type === "session.idle" ||
  event.type === "session.execution.succeeded" ||
  event.type === "session.execution.failed" ||
  event.type === "session.execution.interrupted" ||
  event.type === "session.tool.success" ||
  event.type === "session.tool.failed" ||
  event.type === "session.inbox.enqueued" ||
  event.type === "session.inbox.delivered" ||
  event.type === "session.inbox.cancelled" ||
  event.type === "session.inbox.delivery.changed" ||
  event.type === "form.created" ||
  event.type === "form.replied" ||
  event.type === "form.cancelled"
