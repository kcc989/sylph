import { describe, expect, test } from "bun:test"

import { restartDurableWorkspace } from "./workspace-runtime-lifecycle"

describe("Durable Workspace runtime lifecycle", () => {
  test("recovers through a new instance after forced eviction", async () => {
    const events: string[] = []
    let initializeAttempts = 0

    await restartDurableWorkspace(
      {
        async evict() {
          events.push("evict")
          throw new Error("Durable Object reset")
        },
        async initialize() {
          initializeAttempts += 1
          events.push(`initialize-${initializeAttempts}`)
          if (initializeAttempts === 1) throw new Error("instance restarting")
        },
      },
      {
        attempts: 2,
        async delay() {
          events.push("delay")
        },
      }
    )

    expect(events).toEqual([
      "evict",
      "initialize-1",
      "evict",
      "delay",
      "initialize-2",
    ])
  })

  test("reports the final initialization failure", async () => {
    const failure = new Error("runtime unavailable")

    await expect(
      restartDurableWorkspace(
        {
          async evict() {
            throw new Error("Durable Object reset")
          },
          async initialize() {
            throw failure
          },
        },
        { attempts: 2, delay: async () => undefined }
      )
    ).rejects.toBe(failure)
  })
})
