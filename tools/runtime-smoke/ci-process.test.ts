import { expect, test } from "bun:test"
import { waitForRunnerProcess } from "../../node_modules/@cloudflare/ci/src/ci/runners/runner"

test("observes a process that exited before completion observation began", async () => {
  const sandbox = {
    getProcess: async () => ({ status: "completed", exitCode: 0 }),
    killProcess: async () => {
      throw new Error("Completed process must not be killed")
    },
  }
  expect(await waitForRunnerProcess(sandbox, "process", 100)).toEqual({
    exitCode: 0,
  })
})

test("polls running processes and preserves their failed exit code", async () => {
  let reads = 0
  const sandbox = {
    getProcess: async () =>
      ++reads < 3 ? { status: "running" } : { status: "failed", exitCode: 42 },
    killProcess: async () => {
      throw new Error("Exited process must not be killed")
    },
  }
  expect(await waitForRunnerProcess(sandbox, "process", 100, 1)).toEqual({
    exitCode: 42,
  })
  expect(reads).toBe(3)
})

test("times out a stalled process lookup and requests process termination", async () => {
  const killed: string[] = []
  const sandbox = {
    getProcess: () => new Promise<never>(() => undefined),
    killProcess: async (id: string) => {
      killed.push(id)
    },
  }
  await expect(waitForRunnerProcess(sandbox, "stalled", 10, 1)).rejects.toThrow(
    "exceeded 10 ms"
  )
  expect(killed).toEqual(["stalled"])
})

test("rejects missing processes and completed processes without an exit code", async () => {
  const killProcess = async () => {
    throw new Error("Unexpected termination")
  }
  await expect(
    waitForRunnerProcess(
      { getProcess: async () => null, killProcess },
      "missing",
      100
    )
  ).rejects.toThrow("disappeared")
  await expect(
    waitForRunnerProcess(
      { getProcess: async () => ({ status: "completed" }), killProcess },
      "unknown-exit",
      100
    )
  ).rejects.toThrow("no exit code")
})
