import { describe, expect, test } from "bun:test"

import {
  connectOpenCodeKeyCredential,
  OpenCodeCredentialReloadRequired,
} from "./opencode-key-credential"

const refreshedCatalog = () => ({
  subscribe: async function* () {
    yield { type: "server.connected" }
    yield { type: "catalog.updated" }
  },
})

describe("OpenCode key credential installation", () => {
  test("waits for the refreshed catalog before completing connection", async () => {
    const connected = Promise.withResolvers<IteratorResult<{ type: string }>>()
    const catalogUpdated =
      Promise.withResolvers<IteratorResult<{ type: string }>>()
    const events = [connected.promise, catalogUpdated.promise]
    let eventIndex = 0
    let completed = false

    const connection = connectOpenCodeKeyCredential(
      {
        credential: { remove: async () => undefined },
        events: {
          subscribe: () => ({
            [Symbol.asyncIterator]: () => ({
              next: () => events[eventIndex++]!,
            }),
          }),
        },
        integration: {
          connect: { key: async () => undefined },
          get: async () => ({ data: { connections: [] } }),
        },
      },
      { providerId: "openrouter", key: "fresh-key" }
    ).then(() => {
      completed = true
    })

    connected.resolve({ done: false, value: { type: "server.connected" } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(completed).toBe(false)

    catalogUpdated.resolve({ done: false, value: { type: "catalog.updated" } })
    await connection
    expect(completed).toBe(true)
  })

  test("removes a retained credential and requests a fresh runtime", async () => {
    const calls: string[] = []
    let connectAttempt = 0

    await expect(
      connectOpenCodeKeyCredential(
        {
          credential: {
            remove: async ({ credentialID }) => {
              calls.push(`remove:${credentialID}`)
            },
          },
          events: refreshedCatalog(),
          integration: {
            connect: {
              key: async ({ answer }) => {
                connectAttempt += 1
                calls.push(`connect:${answer?.["accountId"]}`)
                throw {
                  _tag: "InvalidRequestError",
                  message: "Key method does not accept a form answer",
                }
              },
            },
            get: async () => ({
              data: {
                connections: [
                  { type: "credential", id: "credential_old" },
                  { type: "env", name: "CLOUDFLARE_API_KEY" },
                ],
              },
            }),
          },
        },
        {
          providerId: "cloudflare-workers-ai",
          key: "fresh-key",
          configuration: { accountId: "account-1" },
        }
      )
    ).rejects.toBeInstanceOf(OpenCodeCredentialReloadRequired)

    expect(calls).toEqual(["connect:account-1", "remove:credential_old"])
  })

  test("does not replace credentials for another rejection", async () => {
    let removed = false

    await expect(
      connectOpenCodeKeyCredential(
        {
          credential: {
            remove: async () => {
              removed = true
            },
          },
          events: refreshedCatalog(),
          integration: {
            connect: {
              key: async () => {
                throw {
                  _tag: "InvalidRequestError",
                  message: "Account ID is required",
                }
              },
            },
            get: async () => ({ data: { connections: [] } }),
          },
        },
        {
          providerId: "cloudflare-workers-ai",
          key: "fresh-key",
          configuration: { accountId: "account-1" },
        }
      )
    ).rejects.toEqual({
      _tag: "InvalidRequestError",
      message: "Account ID is required",
    })
    expect(removed).toBe(false)
  })

  test("connects without a form answer when configured settings already supply it", async () => {
    const answers: Array<string | undefined> = []

    await connectOpenCodeKeyCredential(
      {
        credential: { remove: async () => undefined },
        events: refreshedCatalog(),
        integration: {
          connect: {
            key: async ({ answer }) => {
              answers.push(answer ? String(answer["accountId"]) : undefined)
              if (answers.length === 1) {
                throw {
                  _tag: "InvalidRequestError",
                  message: "Key method does not accept a form answer",
                }
              }
            },
          },
          get: async () => ({ data: { connections: [] } }),
        },
      },
      {
        providerId: "cloudflare-workers-ai",
        key: "fresh-key",
        configuration: { accountId: "account-1" },
      }
    )

    expect(answers).toEqual(["account-1", undefined])
  })
})
