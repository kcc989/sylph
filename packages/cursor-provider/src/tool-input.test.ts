import { expect, test } from "bun:test"
import { cursorToolInput } from "./tool-input"

test("Cursor file calls use the SDK path argument without losing edit content", () => {
  for (const toolName of ["read", "write", "edit"]) {
    const part = cursorToolInput({
      type: "tool-call",
      toolName,
      toolCallId: "call",
      input: JSON.stringify({
        filePath: "/workspace/proof.txt",
        content: "proof",
        oldString: "before",
        newString: "after",
      }),
    })
    expect(part.type).toBe("tool-call")
    if (part.type !== "tool-call") throw new Error("Missing tool call")
    expect(JSON.parse(part.input)).toEqual({
      path: "/workspace/proof.txt",
      content: "proof",
      oldString: "before",
      newString: "after",
    })
  }
})

test("Cursor cannot overwrite a conflicting explicit path", () => {
  expect(() =>
    cursorToolInput({
      type: "tool-call",
      toolName: "write",
      toolCallId: "call",
      input: '{"path":"/workspace/a","filePath":"/workspace/b"}',
    })
  ).toThrow("conflicting file paths")
})

test("Cursor leaves correctly shaped calls and other tools unchanged", () => {
  for (const toolName of ["read", "custom"]) {
    const part = {
      type: "tool-call",
      toolName,
      toolCallId: "call",
      input: '{"path":"/workspace/a"}',
    } as const
    expect(cursorToolInput(part)).toBe(part)
  }
})
