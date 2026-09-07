export const previewRetention = (configuredSeconds?: string) => {
  if (!configuredSeconds) return "7 days" as const
  const seconds = Number(configuredSeconds)
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("Preview retention seconds must be a non-negative number")
  }
  return seconds
}
