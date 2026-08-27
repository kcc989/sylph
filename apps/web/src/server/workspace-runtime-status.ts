export const workspaceRuntimeStatus = (
  active: boolean,
  messages: ReadonlyArray<{
    type: string
    time: { created: number; completed?: number }
  }>
) => {
  const latest = messages.at(-1)
  const completed =
    latest?.type === "assistant" && latest.time.completed !== undefined
  return active && !completed ? "running" : "ready"
}
