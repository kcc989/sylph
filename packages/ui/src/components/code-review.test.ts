import { describe, expect, test } from "bun:test"

import { patchFilePath, splitFilePatches } from "./code-review"

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

  test("reads added and deleted file paths from a patch", () => {
    expect(
      patchFilePath(
        "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@"
      )
    ).toBe("a.ts")
    expect(
      patchFilePath(
        "diff --git a/removed.ts b/removed.ts\n--- a/removed.ts\n+++ /dev/null\n@@ -1 +0,0 @@"
      )
    ).toBe("removed.ts")
  })
})
