import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { CursorProviderFailure } from "@workspace/domain/cursor-provider"
import { Schema } from "effect"

const decodeInput = Schema.decodeUnknownSync(Schema.JsonObject)

export const cursorToolInput = (part: LanguageModelV3StreamPart) => {
  if (
    part.type !== "tool-call" ||
    !["read", "write", "edit"].includes(part.toolName)
  )
    return part
  const input = decodeInput(JSON.parse(part.input))
  if (!Schema.is(Schema.String)(input.filePath)) return part
  if (input.path !== undefined && input.path !== input.filePath)
    throw new CursorProviderFailure({
      message: "Cursor supplied conflicting file paths",
    })
  const { filePath, ...rest } = input
  return { ...part, input: JSON.stringify({ ...rest, path: filePath }) }
}
