import { describe, expect, test } from "bun:test"

import {
  connectOpenCodeKeyCredential,
  OpenCodeCredentialReloadRequired,
} from "./opencode-key-credential"

describe("OpenCode key credential installation", () => {
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
