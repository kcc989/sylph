import type { WorkspaceRuntimeMessage } from "@workspace/domain"

export type WorkspaceRuntimeMessageSource = {
  id: string
  type: string
  time: { created: number; completed?: number }
  text?: string
  content?: ReadonlyArray<{ type: string; text?: string; name?: string }>
  error?: { message: string }
}

const messageText = (message: {
  content: ReadonlyArray<{ type: string; text?: string }>
}) =>
  message.content
    .filter(
      (part): part is { type: string; text: string } =>
        part.type === "text" && part.text !== undefined
    )
    .map((part) => part.text)
    .join("\n\n")

const messageTools = (message: {
  content: ReadonlyArray<{ type: string; name?: string }>
}) =>
  message.content.flatMap((part) =>
    part.type === "tool" && part.name ? [part.name] : []
  )

export const workspaceRuntimeMessages = (
  messages: ReadonlyArray<WorkspaceRuntimeMessageSource>
): WorkspaceRuntimeMessage[] =>
  messages.reduce<WorkspaceRuntimeMessage[]>((result, message) => {
    if (message.type === "user" && message.text !== undefined) {
      result.push({
        id: message.id,
        role: "user",
        text: message.text,
        createdAt: message.time.created,
        tools: [],
        error: null,
      })
      return result
    }

    if (message.type === "assistant" && message.content) {
      const tools = messageTools({ content: message.content })
      const text = messageText({ content: message.content })
      result.push({
        id: message.id,
        role: "assistant",
        text: text || (tools.length ? `Used ${tools.join(", ")}` : ""),
        createdAt: message.time.created,
        tools,
        error: message.error?.message ?? null,
      })
    }

    return result
  }, [])
