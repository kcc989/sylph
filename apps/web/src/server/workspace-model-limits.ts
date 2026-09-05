import type { Model } from "@opencode-ai/schema/model"

export const workspaceModelContextLimit = 32_768
export const workspaceModelInputLimit = 24_576
export const workspaceModelOutputLimit = 4_096
export const workspaceModelRequestByteLimit = 128 * 1024
export const workspaceCompactionRequestByteLimit = 1024 * 1024

export const boundedWorkspaceModelLimits = (limit: Model.Info["limit"]) => ({
  ...limit,
  context: Math.min(limit.context, workspaceModelContextLimit),
  input: Math.min(limit.input ?? limit.context, workspaceModelInputLimit),
  output: Math.min(limit.output, workspaceModelOutputLimit),
})

export const assertWorkspaceModelRequestSize = async (
  request: Request,
  agent?: string
) => {
  const limit =
    agent === "compaction"
      ? workspaceCompactionRequestByteLimit
      : workspaceModelRequestByteLimit
  if (!request.body) return
  const reader = request.clone().body?.getReader()
  if (!reader) return
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return
      bytes += chunk.value.byteLength
      if (bytes > limit) {
        console.warn("Workspace model request blocked", {
          bytes,
          limit,
        })
        throw new Error(
          "Model request stopped: context exceeds the Workspace request limit. Start a fresh conversation with a short summary before continuing."
        )
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
