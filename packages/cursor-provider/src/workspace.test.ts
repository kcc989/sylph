import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { syncCursorWorkspace } from "./workspace"

test("Cursor workspace replaces stale files and preserves binary content", async () => {
  const root = await mkdtemp(join(tmpdir(), "cursor-files-"))
  try {
    await syncCursorWorkspace(root, [{ path: "old.txt", content: "b2xk" }])
    await symlink(tmpdir(), join(root, "linked"))
    await syncCursorWorkspace(root, [
      { path: "linked/new.bin", content: "AP8B" },
    ])
    expect(await readFile(join(root, "linked/new.bin"))).toEqual(
      Buffer.from([0, 255, 1])
    )
    await expect(readFile(join(root, "old.txt"))).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("Cursor rejects unsafe snapshots before changing existing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "cursor-paths-"))
  try {
    await syncCursorWorkspace(root, [{ path: "kept", content: "b2s=" }])
    for (const path of [
      "../escape",
      "/tmp/escape",
      "a/../../escape",
      ".git/config",
      "a\\escape",
      "",
      "a//b",
    ]) {
      await expect(
        syncCursorWorkspace(root, [{ path, content: "" }])
      ).rejects.toThrow("Invalid")
    }
    expect(await readFile(join(root, "kept"), "utf8")).toBe("ok")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
