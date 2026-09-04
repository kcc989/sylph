import { describe, expect, test } from "bun:test"
import {
  decodeRunnerOutput,
  encodeRunnerOutput,
} from "../../node_modules/@cloudflare/ci/src/pipeline/runner-group"

const result = (
  stdout: string | ReadableStream<Uint8Array>,
  stderr: string | ReadableStream<Uint8Array> = ""
) => ({
  exitCode: 0,
  logs: { stdout, stderr },
  snapshot: { id: "fixture-snapshot", dir: "/workspace" },
  cachePointer: {
    key: "fixture-cache",
    createdAt: "2026-09-04T00:00:00Z",
    sizeBytes: 123,
  },
})

const stream = (text: string, chunkSize = 32768) => {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) return controller.close()
      const end = Math.min(offset + chunkSize, bytes.length)
      controller.enqueue(bytes.slice(offset, end))
      offset = end
    },
  })
}

describe("CI persisted runner output", () => {
  test("preserves a five MiB lockfile result, stderr, and snapshot metadata", async () => {
    const stdout = `SYLPH_DEPENDENCY_RESULT=${Buffer.from("x".repeat(5 * 1024 * 1024)).toString("base64")}\n`
    const stderr = "diagnostic\n".repeat(40000)
    const output = await decodeRunnerOutput(
      encodeRunnerOutput(result(stream(stdout), stream(stderr)))
    )
    expect(output.logs.stdout === stdout).toBe(true)
    expect(output.logs.stderr === stderr).toBe(true)
    expect(output.snapshot).toEqual(result("").snapshot)
    expect(output.cachePointer).toEqual(result("").cachePointer)
  })

  test("preserves split UTF-8 characters and JSON escaping", async () => {
    const text = 'line\n"quoted"\\\t€🦭'
    const output = await decodeRunnerOutput(
      encodeRunnerOutput(result(stream(text, 1)))
    )
    expect(output.logs.stdout).toBe(text)
  })

  test("cancels both source streams on persistence overflow", async () => {
    const cancelled: string[] = []
    const source = (name: string) =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(256).fill(120))
        },
        cancel() {
          cancelled.push(name)
        },
      })
    await expect(
      decodeRunnerOutput(
        encodeRunnerOutput(result(source("stdout"), source("stderr")), 512)
      )
    ).rejects.toThrow("persisted bytes")
    expect(cancelled.sort()).toEqual(["stderr", "stdout"])
  })

  test("cancels an in-flight read and the unread stderr stream", async () => {
    const cancelled: string[] = []
    const source = (name: string) =>
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled.push(name)
        },
      })
    const reader = encodeRunnerOutput(
      result(source("stdout"), source("stderr"))
    ).getReader()
    await reader.read()
    const pending = reader.read()
    await Promise.resolve()
    await reader.cancel()
    expect((await pending).done).toBe(true)
    expect(cancelled.sort()).toEqual(["stderr", "stdout"])
  })

  test("bounds replayed output and validates its shape", async () => {
    await expect(
      decodeRunnerOutput(stream("x".repeat(2048)), 512)
    ).rejects.toThrow("persisted bytes")
    await expect(decodeRunnerOutput(stream('{"logs":{}}'))).rejects.toThrow()
  })

  test("accepts inline results saved before the transport change", async () => {
    const original = result("old stdout", "old stderr")
    expect(await decodeRunnerOutput(original)).toBe(original)
  })
})
