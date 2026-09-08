export function redactLifecycleError(
  message: string,
  secrets: readonly string[]
) {
  let redacted = message
  for (const value of secrets)
    if (value) redacted = redacted.replaceAll(value, "[redacted]")
  return redacted
}
