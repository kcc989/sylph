import type {
  WorkspaceMessagePart,
  WorkspaceRuntimeMessage,
} from "@workspace/domain"
import { Option, Schema } from "effect"
import { WorkspaceBrowserToolOutput } from "@workspace/domain"

import { workspaceConversationText } from "./workspace-conversation-notice"

export const workspaceToolOutputLimit = 16 * 1024

type RuntimeToolContent =
  | { type: "text"; text: string }
  | { type: "file"; uri: string; mime: string; name?: string | null }

type RuntimeToolFile = { uri: string; mime: string; name?: string }

type RuntimeToolState =
  | { status: "streaming"; input: string }
  | { status: "running"; input: object; metadata: object }
  | {
      status: "completed"
      input: object
      content: ReadonlyArray<RuntimeToolContent>
      metadata?: object
    }
  | {
      status: "error"
      input: object
      error: { type: string; message: string; status?: number }
      content?: ReadonlyArray<RuntimeToolContent>
      metadata?: object
    }

type RuntimeContentPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; id: string; name: string; state: RuntimeToolState }

export type WorkspaceRuntimeMessageSource = {
  id: string
  type: string
  time: { created: number; completed?: number }
  text?: string
  status?: string
  metadata?: typeof Schema.JsonObject.Type
  content?: ReadonlyArray<RuntimeContentPart>
  error?: { message: string }
}

const decodeToolInput = Schema.decodeUnknownOption(Schema.JsonObject)
const decodeBrowserOutput = Schema.decodeUnknownOption(
  Schema.fromJsonString(WorkspaceBrowserToolOutput)
)

const textOutput = (content: ReadonlyArray<RuntimeToolContent>) =>
  content
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .join("\n")

const toolFiles = (content: ReadonlyArray<RuntimeToolContent>) =>
  content.flatMap((item) => {
    if (item.type !== "file") return []
    const file: RuntimeToolFile = {
      uri: item.uri,
      mime: item.mime,
    }
    if (item.name !== undefined && item.name !== null) file.name = item.name
    return [file]
  })

const boundedOutput = (output: string) => ({
  output: output.slice(0, workspaceToolOutputLimit),
  outputTruncated: output.length > workspaceToolOutputLimit,
})

const browserOutput = (output: string) => {
  if (output.length <= workspaceToolOutputLimit) return boundedOutput(output)
  const lineEnd = output.indexOf("\n")
  const decoded = decodeBrowserOutput(
    lineEnd === -1 ? output : output.slice(0, lineEnd)
  )
  if (Option.isNone(decoded)) return boundedOutput(output)
  const value = decoded.value
  const header = JSON.stringify(
    new WorkspaceBrowserToolOutput({
      url: value.url,
      checkId: value.checkId,
      evidence: value.evidence,
      session: value.session,
      journey: value.journey,
      policy: value.policy,
      pages: value.pages,
      accessibility:
        "Open the accessibility evidence for the complete snapshot.",
      outcome: value.outcome,
      detail: value.detail,
    })
  )
  return {
    ...boundedOutput(
      `${header}\n${lineEnd === -1 ? "" : output.slice(lineEnd + 1)}`
    ),
    outputTruncated: true,
  }
}

const toolPart = (
  part: RuntimeContentPart
): WorkspaceMessagePart | undefined => {
  if (part.type !== "tool") return undefined
  const state = part.state
  const stateStatus = state.status
  const status =
    stateStatus === "streaming" || stateStatus === "running"
      ? "running"
      : stateStatus
  const content = "content" in state ? (state.content ?? []) : []
  const output =
    part.name === "workspace_browser"
      ? browserOutput(textOutput(content))
      : boundedOutput(textOutput(content))
  const input =
    stateStatus === "streaming"
      ? {}
      : Option.getOrElse(decodeToolInput(state.input), () => ({}))
  return {
    type: "tool",
    id: part.id,
    name: part.name,
    status,
    input,
    ...output,
    files: toolFiles(content),
    error: stateStatus === "error" ? state.error.message : null,
  }
}

const assistantParts = (
  content: ReadonlyArray<RuntimeContentPart>
): WorkspaceMessagePart[] => {
  const parts: WorkspaceMessagePart[] = []
  let text: string[] = []
  const flushText = () => {
    if (!text.length) return
    parts.push({ type: "text", text: text.join("\n\n") })
    text = []
  }

  for (const part of content) {
    if (part.type === "text") {
      text.push(part.text)
      continue
    }
    if (part.type === "reasoning") continue
    flushText()
    const parsed = toolPart(part)
    if (parsed) parts.push(parsed)
  }
  flushText()
  return parts
}

export const workspaceRuntimeMessages = (
  messages: ReadonlyArray<WorkspaceRuntimeMessageSource>
): WorkspaceRuntimeMessage[] =>
  messages.reduce<WorkspaceRuntimeMessage[]>((result, message) => {
    if (message.type === "compaction" && message.status === "completed") {
      result.push({
        id: message.id,
        role: "assistant",
        createdAt: message.time.created,
        parts: [
          {
            type: "text",
            text: "Conversation context shortened. Earlier messages and files are preserved.",
          },
        ],
        error: null,
      })
      return result
    }
    if (message.type === "compaction" && message.error) {
      result.push({
        id: message.id,
        role: "assistant",
        createdAt: message.time.created,
        parts: [],
        error: `Could not shorten conversation context: ${message.error.message}`,
      })
      return result
    }
    if (
      (message.type === "user" || message.type === "synthetic") &&
      message.text !== undefined
    ) {
      const display = workspaceConversationText(message.text, message.metadata)
      if (message.type === "synthetic" && !display.notice) return result
      const displayed: WorkspaceRuntimeMessage = {
        id: message.id,
        role: "user",
        createdAt: message.time.created,
        parts: [{ type: "text", text: display.text }],
        error: null,
      }
      result.push(
        display.notice ? { ...displayed, notice: display.notice } : displayed
      )
      return result
    }

    if (message.type === "assistant" && message.content) {
      result.push({
        id: message.id,
        role: "assistant",
        createdAt: message.time.created,
        parts: assistantParts(message.content),
        error: message.error?.message ?? null,
      })
    }

    return result
  }, [])
