import type { WorkspaceRuntimeMessage } from "@workspace/domain"
import type { ThreadEntry } from "@workspace/ui/components/workspace/types"

import { toolCallEntry } from "@/lib/tool-call-entries"
import type { WorkspaceLiveState } from "@/lib/workspace-runtime-events"

export type WorkspaceThreadSnapshot = {
  errorSummary?: string | null
  files: ReadonlyArray<string>
  messages: ReadonlyArray<WorkspaceRuntimeMessage>
  status: string
}

export type MatchWorkspaceSkill = (text: string) => ThreadEntry["skill"]

export const workspaceThreadEntries = (
  snapshot: WorkspaceThreadSnapshot,
  liveState: WorkspaceLiveState,
  optimisticEntries: ReadonlyArray<ThreadEntry>,
  matchSkill: MatchWorkspaceSkill
): ThreadEntry[] => {
  const snapshotEntries: ThreadEntry[] =
    snapshot.status === "error"
      ? [
          {
            id: "workspace-error",
            kind: "agent",
            title: "Workspace startup failed",
            body:
              snapshot.errorSummary ??
              "The assistant did not finish initializing this Workspace.",
            meta: "Action required",
          },
        ]
      : snapshot.status === "provisioning"
        ? [
            {
              id: "workspace-provisioning",
              kind: "result",
              title: "Starting your Workspace",
              body: "Preparing your files and assistant. You can leave this page and return when it is ready.",
              meta: "Starting",
            },
          ]
        : snapshot.messages.length
          ? snapshot.messages.flatMap((message) => {
              if (!message.parts.length && message.error) {
                return [
                  {
                    id: message.id,
                    kind: "agent" as const,
                    title: "Assistant error",
                    body: message.error,
                    meta: "Assistant",
                  },
                ]
              }
              return message.parts.map((part, index): ThreadEntry => {
                if (part.type === "tool") {
                  return {
                    id: `${message.id}:${part.id}`,
                    kind: "tool",
                    title:
                      index === 0 && message.error
                        ? "Assistant error"
                        : undefined,
                    body: "",
                    tool: toolCallEntry(part),
                  }
                }
                return {
                  id: `${message.id}:text:${index}`,
                  kind: message.role === "user" ? "user" : "agent",
                  title:
                    index === 0 && message.error
                      ? "Assistant error"
                      : undefined,
                  body:
                    index === 0 && message.error ? message.error : part.text,
                  skill:
                    message.role === "user" ? matchSkill(part.text) : undefined,
                  meta: message.role === "user" ? "You" : "Assistant",
                }
              })
            })
          : [
              {
                id: "workspace-ready",
                kind: "result",
                title: "Your durable coding Workspace is ready",
                body: "Ask the assistant to build the first feature. Your files and conversation stay with this Workspace between turns.",
              },
            ]

  const snapshotMessageIds = new Set(
    snapshot.messages.map((message) => message.id)
  )
  const streamingEntries: ThreadEntry[] = Object.entries(
    liveState.partialMessages
  )
    .filter(([id]) => !snapshotMessageIds.has(id))
    .map(([id, body]) => ({ id, kind: "agent", body, meta: "Assistant" }))

  return [...snapshotEntries, ...optimisticEntries, ...streamingEntries]
}
