import { WorkspacePromptMetadata } from "@workspace/domain"
import { Option, Schema } from "effect"

const decodeMetadata = Schema.decodeUnknownOption(WorkspacePromptMetadata)

export const workspaceConversationNotice = (
  text: string,
  metadata?: typeof Schema.JsonObject.Type
) => {
  const decoded = Option.getOrNull(decodeMetadata(metadata))
  if (decoded?.sylphOrigin === "user") return undefined
  if (decoded?.sylphNotice) return decoded.sylphNotice
  const check =
    /^Sylph Check [\w-]+ (passed|failed) for Checkpoint ([a-f0-9]{7}) \(attempt \d+\)\./.exec(
      text
    )
  if (check) return { summary: `Checks ${check[1]} · ${check[2]}` }
  if (
    text.startsWith("Repair the failures from Check ") &&
    text.includes("without weakening validation.")
  ) {
    return { summary: "Repairing failed checks" }
  }
  if (
    text.startsWith(
      "Dependency installation succeeded. The generated bun.lock is saved in the durable Workspace"
    )
  ) {
    return { summary: "Dependencies installed · Checks started" }
  }
  if (
    text.startsWith(
      "Dependency installation failed. No successful repair is claimed."
    )
  ) {
    return { summary: "Dependency installation failed" }
  }
  return undefined
}

export const workspaceConversationText = (
  text: string,
  metadata?: typeof Schema.JsonObject.Type
) => {
  const notice = workspaceConversationNotice(text, metadata)
  return notice ? { text: notice.summary, notice } : { text }
}
