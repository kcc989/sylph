import {
  WorkspaceRuntimeEvent,
  WorkspaceSocketAttachment,
  type WorkspacePresenceUser,
  type WorkspaceSocketServerFrame,
} from "@workspace/domain"
import { Option, Schema } from "effect"

export const decodeWorkspaceSocketAttachment = Schema.decodeUnknownSync(
  WorkspaceSocketAttachment
)

const encoder = new TextEncoder()
const decodeWorkspaceEventSession = Schema.decodeUnknownOption(
  Schema.Union([
    Schema.Struct({ sessionID: Schema.NonEmptyString }),
    Schema.Struct({
      form: Schema.Struct({ sessionID: Schema.NonEmptyString }),
    }),
  ])
)
const maxOutboundFrameBytes = 64 * 1024
const forwardedWorkspaceEventTypes = new Set([
  "form.cancelled",
  "form.created",
  "form.replied",
  "permission.asked",
  "permission.replied",
  "session.execution.started",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.execution.succeeded",
  "session.idle",
  "session.inbox.cancelled",
  "session.inbox.delivered",
  "session.inbox.delivery.changed",
  "session.inbox.enqueued",
  "session.text.delta",
  "session.text.ended",
  "session.tool.called",
  "session.tool.failed",
  "session.tool.success",
])

export const shouldForwardWorkspaceEvent = (event: { type: string }) =>
  forwardedWorkspaceEventTypes.has(event.type)

export const workspaceEventCursor = (event: WorkspaceRuntimeEvent) =>
  event.durable?.seq ?? null

export const workspaceEventSessionId = (event: WorkspaceRuntimeEvent) => {
  const data = Option.getOrNull(decodeWorkspaceEventSession(event.data))
  return data
    ? "sessionID" in data
      ? data.sessionID
      : data.form.sessionID
    : null
}

export const workspaceEventFollowsCursor = (
  event: WorkspaceRuntimeEvent,
  cursor: number | null
) => {
  const sequence = workspaceEventCursor(event)
  return sequence === null || cursor === null || sequence > cursor
}

export const workspacePresence = (
  attachments: ReadonlyArray<WorkspaceSocketAttachment>
): WorkspacePresenceUser[] => {
  const users = new Map<string, WorkspacePresenceUser>()
  for (const attachment of attachments) {
    if (!attachment.sessionId) continue
    const current = users.get(attachment.userId)
    users.set(attachment.userId, {
      userId: attachment.userId,
      name: attachment.name,
      connections: (current?.connections ?? 0) + 1,
    })
  }
  return [...users.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  )
}

const truncatedEvent = (event: WorkspaceRuntimeEvent) =>
  new WorkspaceRuntimeEvent({
    ...event,
    type: "workspace.event.truncated",
    data: {
      truncated: true,
      message: "Event output exceeded the Workspace socket frame limit",
    },
  })

export const encodeWorkspaceSocketFrame = (
  frame: WorkspaceSocketServerFrame
) => {
  const encoded = JSON.stringify(frame)
  if (encoder.encode(encoded).byteLength <= maxOutboundFrameBytes)
    return encoded
  if (frame.type !== "event") {
    throw new Error("Workspace socket frame exceeds the outbound limit")
  }
  const truncated = JSON.stringify({
    type: "event",
    event: truncatedEvent(frame.event),
  } satisfies WorkspaceSocketServerFrame)
  if (encoder.encode(truncated).byteLength > maxOutboundFrameBytes) {
    throw new Error("Workspace socket event exceeds the outbound limit")
  }
  return truncated
}

export { WorkspaceSocketAttachment } from "@workspace/domain"
