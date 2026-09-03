import { describe, expect, test } from "bun:test"

import { listWorkspaceMessages } from "./workspace-message-pages"

describe("listWorkspaceMessages", () => {
  test("uses the initial order only before cursor pagination", async () => {
    const inputs: Array<{
      sessionID: string
      limit: number
      order?: "asc"
      cursor?: string
    }> = []
    const pages = [
      { data: ["first"], cursor: { next: "next-page" } },
      { data: ["second"], cursor: {} },
    ]

    const messages = await listWorkspaceMessages("session-1", async (input) => {
      inputs.push(input)
      const page = pages.shift()
      if (!page) throw new Error("Unexpected page request")
      return page
    })

    expect(messages).toEqual(["first", "second"])
    expect(inputs).toEqual([
      { sessionID: "session-1", limit: 100, order: "asc" },
      { sessionID: "session-1", limit: 100, cursor: "next-page" },
    ])
  })
})
