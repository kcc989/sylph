import { describe, expect, test } from "bun:test"
import { Database, type SQLQueryBindings } from "bun:sqlite"
import git from "isomorphic-git"

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
