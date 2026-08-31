interface ProviderRequestFailure {
  readonly _tag: "InvalidRequestError"
  readonly message: string
}

type ProviderConnectionFailure = Error | ProviderRequestFailure

const reconnectSummary = (providerId: string) =>
  `The AI provider could not connect to ${providerId}. Reconnect it and try again.`

const safeErrorDetail = (error: ProviderConnectionFailure) => {
  const messages: string[] = []
  const visited = new Set<Error>()
  let current = error instanceof Error ? error : undefined

  if (!(error instanceof Error)) messages.push(error.message.trim())

  while (current) {
    if (visited.has(current) || messages.length === 4) break
    visited.add(current)

    const message = current.message.trim()
    if (message && !messages.includes(message)) {
      messages.push(message)
    }
    current = current.cause instanceof Error ? current.cause : undefined
  }

  return messages
    .join(": ")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /\b(token|secret|password|authorization|api[-_ ]?key)\s*[:=]\s*\S+/gi,
      "$1=[redacted]"
    )
    .slice(0, 1_000)
}

export const providerConnectionErrorSummary = (
  providerId: string,
  error: ProviderConnectionFailure | null
) => {
  const detail = error ? safeErrorDetail(error) : ""
  if (!detail) return reconnectSummary(providerId)
  return `The AI provider could not connect to ${providerId}. ${detail}`
}
