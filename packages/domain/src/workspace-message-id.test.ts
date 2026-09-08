import { expect, test } from "bun:test"
import { workspacePromptMessageId } from "./conversation"

test("creates agent message IDs with the required prefix", () => {
  expect(workspacePromptMessageId()).toMatch(/^msg_[a-f0-9-]{36}$/)
  expect(workspacePromptMessageId()).not.toBe(workspacePromptMessageId())
})

test("adapts caller IDs deterministically and preserves retries", () => {
  expect(workspacePromptMessageId("request-1")).toBe("msg_request-1")
  expect(workspacePromptMessageId("msg_request-1")).toBe("msg_request-1")
})
