import { describe, expect, test } from "bun:test"
import { Database, type SQLQueryBindings } from "bun:sqlite"
import git from "isomorphic-git"
import { WorkspaceGit } from "./workspace-git"

import {
  normalizeWorkspacePath,
  WorkspaceFilesystem,
} from "./workspace-filesystem"

class TestSqlStorage {
  readonly #database = new Database(":memory:")
  readonly sql = {
    exec: <Row extends Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: SqlStorageValue[]
    ) => {
      const parameters: SQLQueryBindings[] = bindings.map((binding) =>
        binding instanceof ArrayBuffer ? new Uint8Array(binding) : binding
      )
      const rows = this.#database
        .query<Row, SQLQueryBindings[]>(query)
        .all(...parameters)
      return { toArray: () => rows }
    },
  }
}

describe("WorkspaceFilesystem", () => {
  test("recovers a damaged file from a Checkpoint without reverting other files", async () => {
    const storage = new TestSqlStorage()
    const filesystem = new WorkspaceFilesystem(storage)
    filesystem.initialize()
    await git.init({ fs: filesystem, dir: "/workspace", defaultBranch: "main" })
    const original = "dependency\n".repeat(20_000)
    await filesystem.writeFile("bun.lock", original)
    await git.add({ fs: filesystem, dir: "/workspace", filepath: "bun.lock" })
    const commit = await git.commit({
      fs: filesystem,
      dir: "/workspace",
      message: "Valid dependencies",
      author: { name: "Test", email: "test@example.com" },
    })
    await filesystem.writeFile("bun.lock", "truncated")
    await filesystem.writeFile("app.ts", "new application")
    const workspaceGit = new WorkspaceGit(
      storage,
      {
        get: async () => {
          throw new Error("Recovery must use local Git objects")
        },
      },
      filesystem
    )

    const restored = await workspaceGit.readCheckpointFile(
      "/workspace/bun.lock"
    )
    await filesystem.writeFile("bun.lock", restored.content)

    expect(restored.commit).toBe(commit)
    expect(await filesystem.readFile("bun.lock", "utf8")).toBe(original)
    expect(await filesystem.readFile("app.ts", "utf8")).toBe("new application")
    await expect(
      workspaceGit.readCheckpointFile(".git/config")
    ).rejects.toThrow()
    await expect(
      workspaceGit.readCheckpointFile("../outside")
    ).rejects.toThrow()
    await expect(workspaceGit.readCheckpointFile("app.ts")).rejects.toThrow()
    expect(await filesystem.readFile("app.ts", "utf8")).toBe("new application")
  })

  test("edits a large durable file while preserving surrounding bytes", async () => {
    const storage = new TestSqlStorage()
    const filesystem = new WorkspaceFilesystem(storage)
    filesystem.initialize()
    const prefix = "unchanged\r\n".repeat(20_000)
    const suffix = "\r\nkept ünicode\r\n"
    await filesystem.writeFile("bun.lock", `${prefix}old dependency${suffix}`)

    await filesystem.editFile(
      "/workspace/bun.lock",
      "old dependency",
      "$& new dependency"
    )

    const restored = new WorkspaceFilesystem(storage)
    expect(await restored.readFile("bun.lock", "utf8")).toBe(
      `${prefix}$& new dependency${suffix}`
    )
  })

  test("rejects stale, empty, and ambiguous edits without changing the file", async () => {
    const filesystem = new WorkspaceFilesystem(new TestSqlStorage())
    filesystem.initialize()
    await filesystem.writeFile("file.txt", "same same aaa")

    for (const oldText of ["missing", "", "same", "aa"]) {
      await expect(
        filesystem.editFile("file.txt", oldText, "new")
      ).rejects.toMatchObject({
        _tag: "WorkspaceEditConflict",
      })
      expect(await filesystem.readFile("file.txt", "utf8")).toBe(
        "same same aaa"
      )
    }
    await filesystem.editFile("file.txt", "same same ", "")
    expect(await filesystem.readFile("file.txt", "utf8")).toBe("aaa")
  })

  test("keeps path and size limits when editing and rejects binary files", async () => {
    const filesystem = new WorkspaceFilesystem(new TestSqlStorage(), {
      file: 5,
    })
    filesystem.initialize()
    await filesystem.writeFile("file.txt", "small")
    await filesystem.writeFile("binary.bin", new Uint8Array([255]))

    await expect(
      filesystem.editFile("../file.txt", "small", "new")
    ).rejects.toMatchObject({ code: "EINVAL" })
    await expect(
      filesystem.editFile("file.txt", "small", "too large")
    ).rejects.toMatchObject({ code: "EFBIG" })
    await expect(
      filesystem.editFile("missing.txt", "old", "new")
    ).rejects.toMatchObject({ code: "ENOENT" })
    await expect(
      filesystem.editFile("binary.bin", "old", "new")
    ).rejects.toBeDefined()
    expect(await filesystem.readFile("file.txt", "utf8")).toBe("small")
  })

  test("rejects paths outside the Workspace", () => {
    expect(() => normalizeWorkspacePath("../secret")).toThrow("EINVAL")
    expect(() => normalizeWorkspacePath("/etc/passwd")).toThrow("EINVAL")
  })

  test("preserves the working copy and Git objects across service recreation", async () => {
    const storage = new TestSqlStorage()
    const first = new WorkspaceFilesystem(storage)
    first.initialize()
    await git.init({ fs: first, dir: "/workspace", defaultBranch: "main" })
    await first.writeFile("/workspace/README.md", "# Durable\n")
    await git.add({ fs: first, dir: "/workspace", filepath: "README.md" })
    const commit = await git.commit({
      fs: first,
      dir: "/workspace",
      message: "Initial checkpoint",
      author: { name: "Sylph", email: "test@sylph.dev" },
    })

    const restored = new WorkspaceFilesystem(storage)
    restored.initialize()
    const restoredCommit = await git.resolveRef({
      fs: restored,
      dir: "/workspace",
      ref: "HEAD",
    })
    const content = await restored.readFile("README.md", "utf8")

    expect(restoredCommit).toBe(commit)
    expect(content).toBe("# Durable\n")
    expect(restored.listWorkingFiles()).toEqual(["README.md"])
  })

  test("tracks additions, edits, and deletions for checkpoint staging", async () => {
    const storage = new TestSqlStorage()
    const filesystem = new WorkspaceFilesystem(storage)
    filesystem.initialize()
    await git.init({ fs: filesystem, dir: "/workspace", defaultBranch: "main" })
    await filesystem.writeFile("one.txt", "one\n")
    await filesystem.writeFile("gone.txt", "gone\n")
    await git.add({ fs: filesystem, dir: "/workspace", filepath: "one.txt" })
    await git.add({ fs: filesystem, dir: "/workspace", filepath: "gone.txt" })
    await git.commit({
      fs: filesystem,
      dir: "/workspace",
      message: "Baseline",
      author: { name: "Sylph", email: "test@sylph.dev" },
    })

    await filesystem.writeFile("one.txt", "changed\n")
    await filesystem.writeFile("new.txt", "new\n")
    await filesystem.unlink("gone.txt")
    const matrix = await git.statusMatrix({
      fs: filesystem,
      dir: "/workspace",
    })

    expect(matrix.map(([file]) => file)).toEqual([
      "gone.txt",
      "new.txt",
      "one.txt",
    ])
    expect(matrix.filter(([, head, working]) => head !== working)).toHaveLength(
      3
    )
  })

  test("enforces file and repository size limits", async () => {
    const storage = new TestSqlStorage()
    const filesystem = new WorkspaceFilesystem(storage, {
      file: 4,
      repository: 6,
    })
    filesystem.initialize()

    await expect(filesystem.writeFile("large.txt", "12345")).rejects.toThrow(
      "EFBIG"
    )
    await filesystem.writeFile("one.txt", "1234")
    await expect(filesystem.writeFile("two.txt", "123")).rejects.toThrow(
      "ENOSPC"
    )
  })
})
