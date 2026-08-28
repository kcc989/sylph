import { describe, expect, test } from "bun:test"

import { activateCredentialAndWaitForCatalog } from "./opencode-credential-activation"

const deferred = <Value>() => {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("OpenCode credential activation", () => {
  test("waits for the refreshed catalog before completing activation", async () => {
    const connected = deferred<IteratorResult<{ type: string }>>()
    const catalogUpdated = deferred<IteratorResult<{ type: string }>>()
    const activationStarted = deferred<void>()
    const events = [connected.promise, catalogUpdated.promise]
    let eventIndex = 0
    let activated = false

    const activation = activateCredentialAndWaitForCatalog(
      {
        credential: {
          activate: async ({ credentialID }) => {
            expect(credentialID).toBe("cred_openai")
            activated = true
            activationStarted.resolve()
          },
        },
        events: {
          subscribe: () => ({
            [Symbol.asyncIterator]: () => ({
              next: () => events[eventIndex++]!,
            }),
          }),
        },
      },
      "cred_openai"
    )

    connected.resolve({ done: false, value: { type: "server.connected" } })
    await activationStarted.promise
    expect(activated).toBe(true)

    let completed = false
    void activation.then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)

    catalogUpdated.resolve({ done: false, value: { type: "catalog.updated" } })
    await activation
    expect(completed).toBe(true)
  })
})
