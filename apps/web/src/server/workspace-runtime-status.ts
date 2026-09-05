export const workspaceRuntimeStatus = (
  active: boolean,
  outcome?: "succeeded" | "failed" | "interrupted"
) => {
  if (active) return "running"
  return outcome === "interrupted" ? "interrupted" : "ready"
}
