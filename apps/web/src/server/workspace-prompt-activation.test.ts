import { describe, expect, test } from "bun:test"

import { activateWorkspacePrompt } from "./workspace-prompt-activation"

describe("Workspace prompt activation", () => {
  test("refreshes the credential before every same-provider turn", async () => {
    const calls: string[] = []
    const activation = {
      refreshCredential: async () => {
        calls.push("credential")
      },
      switchModel: async () => {
        calls.push("model")
      },
    }

    await activateWorkspacePrompt(activation)
    await activateWorkspacePrompt(activation)

    expect(calls).toEqual(["credential", "model", "credential", "model"])
  })

  test("switches models without reinstalling an unchanged credential", async () => {
    const calls: string[] = []

    await activateWorkspacePrompt({
      switchModel: async () => {
        calls.push("model")
      },
    })

    expect(calls).toEqual(["model"])
  })
})
