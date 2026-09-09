import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"

export const cursorToolNames = (options: LanguageModelV3CallOptions) => {
  const aliasShell =
    options.tools?.some(
      (tool) => tool.type === "function" && tool.name === "shell"
    ) &&
    !options.tools.some(
      (tool) => tool.type === "function" && tool.name === "bash"
    )
  if (!aliasShell)
    return { options, output: (part: LanguageModelV3StreamPart) => part }
  const rename = (name: string) => (name === "shell" ? "bash" : name)
  return {
    options: {
      ...options,
      tools: options.tools?.map((tool) =>
        tool.type === "function" ? { ...tool, name: rename(tool.name) } : tool
      ),
      toolChoice:
        options.toolChoice?.type === "tool"
          ? {
              ...options.toolChoice,
              toolName: rename(options.toolChoice.toolName),
            }
          : options.toolChoice,
      prompt: options.prompt.map((message) =>
        message.role === "assistant"
          ? {
              ...message,
              content: message.content.map((part) =>
                part.type === "tool-call" || part.type === "tool-result"
                  ? { ...part, toolName: rename(part.toolName) }
                  : part
              ),
            }
          : message.role === "tool"
            ? {
                ...message,
                content: message.content.map((part) =>
                  part.type === "tool-result"
                    ? { ...part, toolName: rename(part.toolName) }
                    : part
                ),
              }
            : message
      ),
    } satisfies LanguageModelV3CallOptions,
    output: (part: LanguageModelV3StreamPart): LanguageModelV3StreamPart =>
      "toolName" in part && part.toolName === "bash"
        ? { ...part, toolName: "shell" }
        : part,
  }
}
