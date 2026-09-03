export const workspaceFileDisplayLimit = 256 * 1024

export const workspaceFileContainsNull = (content: Uint8Array) =>
  content.includes(0)

export const workspaceFileEncoding = (
  size: number,
  content: Uint8Array | null,
  limit = workspaceFileDisplayLimit
) => {
  if (size > limit) return "too-large" as const
  if (content && workspaceFileContainsNull(content)) return "binary" as const
  return "utf8" as const
}
