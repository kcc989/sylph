import type { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd"
import type { WorkspaceCheckCompletion } from "@workspace/domain"

type Sessions = Pick<OpenCodeWorkerd.Interface["sessions"], "synthetic"> & {
  inbox: Pick<OpenCodeWorkerd.Interface["sessions"]["inbox"], "list">
}

export const deliverCheckCompletion = async (
  sessions: Sessions,
  sessionID: string,
  completion: WorkspaceCheckCompletion
) => {
  const input = {
    id: completion.id,
    sessionID,
    text: completion.text,
    resume: false,
    delivery: completion.resume ? ("queue" as const) : ("steer" as const),
    metadata: {
      sylphOrigin: "check",
      sylphNotice: {
        summary: completion.summary,
      },
    },
  }
  await sessions.synthetic(input)
  if (!completion.resume) return
  const pending = await sessions.inbox.list({ sessionID })
  if (!pending.some((message) => message.id === completion.id)) return
  await sessions.synthetic({ ...input, resume: true })
}
