export const workspaceRuntimeStatus = (
  active: boolean,
  messages: ReadonlyArray<{
    type: string
    time: { created: number; completed?: number }
  }>,
  outcome?: "succeeded" | "failed" | "interrupted"
) => {
  const latest = messages.at(-1)
  const completed =
    latest?.type === "assistant" && latest.time.completed !== undefined
  if (active && !completed) return "running"
  return outcome === "interrupted" ? "interrupted" : "ready"
}
