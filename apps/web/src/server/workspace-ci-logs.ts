type LogValue = string | ReadableStream<Uint8Array>

const maxCiLogBytes = 12 * 1024 * 1024

export const readWorkspaceCiLogs = async (
  logs: { stdout: LogValue; stderr: LogValue },
  maxBytes = maxCiLogBytes
) => {
  let remaining = maxBytes
  const consume = (bytes: number) => {
    remaining -= bytes
    if (remaining < 0) throw new Error(`CI output exceeds ${maxBytes} bytes`)
  }
  const read = async (value: LogValue) => {
    if (!(value instanceof ReadableStream)) {
      if (value.length > remaining) consume(value.length)
      consume(new TextEncoder().encode(value).byteLength)
      return value
    }
    const reader = value.getReader()
    const decoder = new TextDecoder()
    const parts: string[] = []
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        consume(next.value.byteLength)
        parts.push(decoder.decode(next.value, { stream: true }))
      }
      parts.push(decoder.decode())
      return parts.join("")
    } catch (cause) {
      await reader.cancel(cause).catch(() => undefined)
      throw cause
    } finally {
      reader.releaseLock()
    }
  }
  try {
    const stdout = await read(logs.stdout)
    const stderr = await read(logs.stderr)
    return { stdout, stderr }
  } catch (cause) {
    for (const value of [logs.stdout, logs.stderr]) {
      if (value instanceof ReadableStream && !value.locked)
        await value.cancel(cause).catch(() => undefined)
    }
    throw cause
  }
}
