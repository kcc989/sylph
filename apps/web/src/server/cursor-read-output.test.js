import { expect, test } from "bun:test"
import { buildTypedExecResult } from "../../../../node_modules/cursor-opencode-provider/dist/protocol/tools.js"
import { cursorReadOutput } from "./cursor-read-output"

const result = (output) =>
  buildTypedExecResult(
    "read_result",
    cursorReadOutput(output),
    undefined,
    "read"
  )

test("Cursor receives raw file contents instead of the current SDK read envelope", () => {
  const read = result(
    'Read file /workspace/package.json, lines 1-3\n1: {\n2:   "name": "fixture"\n3: }'
  )
  expect(read.success.path).toBe("/workspace/package.json")
  expect(read.success.content).toBe('{\n  "name": "fixture"\n}')
  expect(read.success.total_lines).toBe(3)
  expect(read.success.truncated).toBe(false)
})

test("read translation preserves empty lines, numbered content, and literal XML", () => {
  expect(
    result(
      "Read file /workspace/example.txt, lines 1-3\n1: 12: literal\n2: \n3: </content>"
    ).success.content
  ).toBe("12: literal\n\n</content>")
  expect(
    result("Read file /workspace/empty.txt, 0 lines").success.content
  ).toBe("")
})

test("partial reads retain their continuation warning", () => {
  const read = result(
    "Read file /workspace/file.txt, lines 3-4\n3: third\n4: fourth\n[Output truncated. Continue reading with offset: 5]"
  )
  expect(read.success.content).toContain("third\nfourth")
  expect(read.success.content).toContain("NOT the complete file")
  expect(read.success.content).toContain("offset=5")
})

test("non-read and malformed output remain unchanged", () => {
  for (const output of [
    "plain text",
    "Read directory /workspace, 0 entries",
    "Read file /workspace/file.txt, lines 1-2\n1: first",
    "Read file /workspace/file.txt, lines 1-1\n2: wrong",
  ]) {
    expect(cursorReadOutput(output)).toBe(output)
  }
})
