import { expect, test } from "bun:test"
import { Effect } from "effect"
import { make } from "@opencode-ai/core/session/run-coordinator"
import { deliverCheckCompletion } from "../../apps/web/src/server/workspace-check-completion"

test("a Check arriving while the current Turn settles registers another drain", async () => {
  let enterSettlement = () => {}
  const settling = new Promise((resolve) => {
    enterSettlement = resolve
  })
  let releaseSettlement = () => {}
  const settled = new Promise((resolve) => {
    releaseSettlement = resolve
  })
  let pending = []
  let drains = 0
  const admitted = new Set()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* make({
          drain: () =>
            Effect.sync(() => {
              drains += 1
              pending = []
            }),
          settled: () =>
            Effect.promise(async () => {
              enterSettlement()
              await settled
            }),
        })
        yield* coordinator.wake("session")
        yield* Effect.promise(async () => {
          await settling
          const sessions = {
            synthetic: async (input) => {
              if (!admitted.has(input.id)) {
                admitted.add(input.id)
                pending.push(input)
              }
              if (input.resume)
                await Effect.runPromise(coordinator.wake("session"))
            },
            inbox: { list: async () => pending },
          }
          const completion = {
            id: "msg_check",
            runId: "check",
            commit: "a".repeat(40),
            attempt: 1,
            text: "Fix the failed Check",
            summary: "Fixing Checks",
            resume: true,
          }
          try {
            await deliverCheckCompletion(sessions, "session", completion)
          } finally {
            releaseSettlement()
          }
          await Effect.runPromise(coordinator.awaitIdle("session"))
          expect(pending).toHaveLength(0)
          expect(drains).toBe(2)
          await deliverCheckCompletion(sessions, "session", completion)
          await Effect.runPromise(coordinator.awaitIdle("session"))
          expect(drains).toBe(2)
        })
      })
    )
  )
})
