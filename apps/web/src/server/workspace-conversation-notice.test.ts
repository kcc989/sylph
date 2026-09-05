import { expect, test } from "bun:test"
import { workspaceConversationText } from "./workspace-conversation-notice"
import { workspaceRuntimeMessages } from "./workspace-runtime-messages"

const report =
  "Sylph Check check-123 failed for Checkpoint d97ca9b (attempt 1).\nStages: test failed.\nInternal instructions\n" +
  "stdout output\n".repeat(1000)

test("legacy check reports exclude instructions and logs from the conversation payload", () => {
  const messages = workspaceRuntimeMessages([
    { id: "report", type: "user", time: { created: 1 }, text: report },
  ])
  expect(messages[0]?.notice?.summary).toBe("Checks failed · d97ca9b")
  expect(JSON.stringify(messages)).not.toContain("stdout")
  expect(JSON.stringify(messages)).not.toContain("Internal instructions")
  expect(workspaceConversationText(report).text).toBe("Checks failed · d97ca9b")
})

test("native metadata displays a notice independently of agent prompt wording", () => {
  expect(
    workspaceConversationText("Private diagnostics", {
      sylphOrigin: "check",
      sylphNotice: { summary: "Checks passed" },
    })
  ).toEqual({ text: "Checks passed", notice: { summary: "Checks passed" } })
})

test("explicit user messages and unrelated text remain intact", () => {
  expect(workspaceConversationText(report, { sylphOrigin: "user" })).toEqual({
    text: report,
  })
  expect(workspaceConversationText("Please repair my checks")).toEqual({
    text: "Please repair my checks",
  })
  expect(
    workspaceConversationText("hello", {
      sylphOrigin: "check",
      sylphNotice: { summary: 4 },
    })
  ).toEqual({ text: "hello" })
})
