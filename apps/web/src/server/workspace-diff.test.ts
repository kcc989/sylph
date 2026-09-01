import { describe, expect, test } from "bun:test"
import { WorkspaceFileChange } from "@workspace/domain"

import { boundedFileChanges } from "./workspace-diff"

const change = (file: string, patch: string) =>
  new WorkspaceFileChange({
    file,
    status: "modified",
    additions: 1,
    deletions: 0,
    patch,
  })

describe("Workspace diff", () => {
  test("passes small diffs through untouched", () => {
    const files = [change("a.ts", "aaaa"), change("b.ts", "bbbb")]
    expect(boundedFileChanges(files, 100)).toEqual({ files, truncated: false })
  })

  test("truncates the first oversized patch and omits the rest", () => {
    const { files, truncated } = boundedFileChanges(
      [change("a.ts", "aaaaaaaa"), change("b.ts", "bbbb")],
      5
    )
    expect(truncated).toBeTrue()
    expect(files[0]?.patch).toBe("aaaaa\n…[patch truncated]")
    expect(files[1]?.patch).toBe("diff --git a/b.ts b/b.ts\n…[patch omitted]")
  })
})
