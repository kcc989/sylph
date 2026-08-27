import { describe, expect, test } from "bun:test"

import { splitFilePatches } from "./code-review"

describe("CodeReview", () => {
  test("separates a combined patch into one patch per file", () => {
    const patch = `diff --git a/first.txt b/first.txt
--- a/first.txt
+++ b/first.txt
@@ -0,0 +1 @@
+first
diff --git a/second.txt b/second.txt
--- a/second.txt
+++ b/second.txt
@@ -0,0 +1 @@
+second`

    expect(splitFilePatches(patch)).toHaveLength(2)
    expect(splitFilePatches(patch)[0]).toContain("a/first.txt")
    expect(splitFilePatches(patch)[1]).toContain("a/second.txt")
  })
})
