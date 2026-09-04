import { expect, test } from "bun:test"
import { readWorkspaceCiLogs } from "./workspace-ci-logs"

test("decodes UTF-8 split between chunks and shares the output budget", async () => {
  const bytes = new TextEncoder().encode("aé")
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 2))
      controller.enqueue(bytes.slice(2))
      controller.close()
    },
  })
  expect(await readWorkspaceCiLogs({ stdout, stderr: "b" }, 4)).toEqual({
    stdout: "aé",
    stderr: "b",
  })
  await expect(
    readWorkspaceCiLogs({ stdout: "aé", stderr: "bc" }, 4)
  ).rejects.toThrow("CI output exceeds 4 bytes")
})

test("cancels both streams when output exceeds the byte limit", async () => {
  const cancelled: string[] = []
  const stream = (name: string) =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(5))
      },
      cancel() {
        cancelled.push(name)
      },
    })
  await expect(
    readWorkspaceCiLogs(
      { stdout: stream("stdout"), stderr: stream("stderr") },
      4
    )
  ).rejects.toThrow("CI output exceeds 4 bytes")
  expect(cancelled).toEqual(["stdout", "stderr"])
})
