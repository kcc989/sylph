import { describe, expect, test } from "bun:test"
import {
  listWorkspaceMessages,
  workspaceMessagePageSize,
} from "./workspace-message-pages"

describe("listWorkspaceMessages", () => {
  test("loads only the latest bounded page in chronological order", async () => {
    const inputs: unknown[] = []
    const page = await listWorkspaceMessages("session-1", async (input) => {
      inputs.push(input)
      return {
        data: Array.from(
          { length: workspaceMessagePageSize },
          (_, index) => 1000 - index
        ),
        cursor: { next: "older" },
      }
    })
    expect(inputs).toEqual([
      {
        sessionID: "session-1",
        limit: workspaceMessagePageSize,
        order: "desc",
      },
    ])
    expect(page.messages[0]).toBe(981)
    expect(page.messages.at(-1)).toBe(1000)
    expect(page.cursor).toBe("older")
  })

  test("uses the cursor without order and ends on a partial page", async () => {
    const page = await listWorkspaceMessages(
      "session-1",
      async (input) => {
        expect(input).toEqual({
          sessionID: "session-1",
          limit: workspaceMessagePageSize,
          cursor: "older",
        })
        return { data: [2, 1], cursor: { next: "unused" } }
      },
      "older"
    )
    expect(page).toEqual({ messages: [1, 2], cursor: null })
  })
})
