import { describe, expect, test } from "bun:test"
import { Database, type SQLQueryBindings } from "bun:sqlite"
import git from "isomorphic-git"
import { DependencyInputFile, DependencyRepairOutput } from "@workspace/domain"
import { WorkspaceGit } from "./workspace-git"

import {
  normalizeWorkspacePath,
  WorkspaceFilesystem,
} from "./workspace-filesystem"

class TestSqlStorage {
  readCount = 0
  readonly #database = new Database(":memory:")
  readonly sql = {
    exec: <Row extends Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: SqlStorageValue[]
    ) => {
      if (query.startsWith("SELECT content")) this.readCount += 1
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
  test("lists root aliases and keeps directory prefixes distinct", async () => {
    const filesystem = new WorkspaceFilesystem(new TestSqlStorage())
    filesystem.initialize()
    await filesystem.writeFile("package.json", "{}")
    await filesystem.writeFile("src/index.ts", "export {}")
    await filesystem.writeFile("src-other/index.ts", "export {}")
    const expected = ["package.json", "src-other/index.ts", "src/index.ts"]
    for (const root of ["", ".", "./", "/", "/workspace", "/workspace/"]) {
      expect(filesystem.listWorkingFiles(root)).toEqual(expected)
    }
    expect(filesystem.listWorkingFiles("./src/")).toEqual(["src/index.ts"])
  })
  test("imports a generated lockfile and preserves unrelated concurrent edits", async () => {
    const filesystem = new WorkspaceFilesystem(new TestSqlStorage())
    filesystem.initialize()
    await filesystem.writeFile("package.json", '{"name":"demo"}')
    await filesystem.writeFile("bun.lock", "damaged")
    const inputs = await Promise.all(
      ["bun.lock", "package.json"].map(
        async (path) =>
          new DependencyInputFile({
            path,
            digest: Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  new Uint8Array(await filesystem.readFile(path))
                )
              )
            )
              .map((byte) => byte.toString(16).padStart(2, "0"))
              .join(""),
          })
      )
    )
    await filesystem.writeFile("app.ts", "concurrent change")
    const lockfile = "generated ünicode\n".repeat(20_000)
    await filesystem.applyDependencyRepair(
      new DependencyRepairOutput({ inputs, lockfile })
    )
    await filesystem.applyDependencyRepair(
      new DependencyRepairOutput({ inputs, lockfile })
    )
    expect(await filesystem.readFile("bun.lock", "utf8")).toBe(lockfile)
    expect(await filesystem.readFile("app.ts", "utf8")).toBe(
      "concurrent change"
    )
    await expect(
      filesystem.applyDependencyRepair(
        new DependencyRepairOutput({ inputs, lockfile: "stale" })
      )
    ).rejects.toMatchObject({ _tag: "DependencyRepairConflict" })
    expect(await filesystem.readFile("bun.lock", "utf8")).toBe(lockfile)
  })

  test("rejects repairs when dependency manifests change or new inputs appear", async () => {
    for (const changed of [
      "package.json",
      "nested/package.json",
      ".npmrc",
      "patches/fix.patch",
    ]) {
      const filesystem = new WorkspaceFilesystem(new TestSqlStorage())
      filesystem.initialize()
      await filesystem.writeFile("package.json", "{}")
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode("{}"))
        )
      )
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
      const inputs = [new DependencyInputFile({ path: "package.json", digest })]
      await filesystem.writeFile(changed, "changed during install")
      await expect(
        filesystem.applyDependencyRepair(
          new DependencyRepairOutput({ inputs, lockfile: "generated" })
        )
      ).rejects.toMatchObject({ _tag: "DependencyRepairConflict" })
      await expect(filesystem.readFile("bun.lock")).rejects.toMatchObject({
        code: "ENOENT",
      })
      expect(await filesystem.readFile(changed, "utf8")).toBe(
        "changed during install"
      )
    }
  })

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

test("reuses unchanged diffs and invalidates them after edits, deletes, and checkpoints", async () => {
  const storage = new TestSqlStorage()
  const filesystem = new WorkspaceFilesystem(storage)
  filesystem.initialize()
  const workspaceGit = new WorkspaceGit(
    storage,
    {
      get: async () => {
        throw new Error("Unexpected remote access")
      },
    },
    filesystem
  )
  workspaceGit.initialize()
  await git.init({ fs: filesystem, dir: "/workspace", defaultBranch: "main" })
  for (let index = 0; index < 30; index += 1) {
    const filepath = `files/file-${index}.txt`
    await filesystem.writeFile(filepath, `original ${index}\n`)
    await git.add({ fs: filesystem, dir: "/workspace", filepath })
  }
  const base = await git.commit({
    fs: filesystem,
    dir: "/workspace",
    message: "Baseline",
    author: { name: "Test", email: "test@example.com" },
  })
  storage.sql.exec(
    "INSERT INTO app_workspace_vcs (singleton, repository_name, repository_remote, project_repository_name, project_repository_remote, default_ref, base_commit, fork_head, project_head, sync_status, merge_status) VALUES (1, 'workspace', 'https://example.com/workspace', 'project', 'https://example.com/project', 'main', ?, ?, ?, 'ready', 'unreviewed')",
    base,
    base,
    base
  )
  const initial = await workspaceGit.versionControl()
  expect(initial.working).toEqual([])
  expect(storage.readCount).toBeGreaterThan(0)
  storage.readCount = 0
  await workspaceGit.versionControl()
  expect(storage.readCount).toBe(0)
  await filesystem.writeFile("files/file-0.txt", "changed\n")
  const changed = await workspaceGit.versionControl()
  expect(changed.working.map((change) => change.file)).toEqual([
    "files/file-0.txt",
  ])
  expect(storage.readCount).toBeGreaterThan(0)
  storage.readCount = 0
  await workspaceGit.versionControl()
  expect(storage.readCount).toBe(0)
  await filesystem.unlink("files/file-1.txt")
  expect(
    (await workspaceGit.versionControl()).working
      .map((change) => change.status)
      .sort()
  ).toEqual(["deleted", "modified"])
  await git.add({
    fs: filesystem,
    dir: "/workspace",
    filepath: "files/file-0.txt",
  })
  await git.remove({
    fs: filesystem,
    dir: "/workspace",
    filepath: "files/file-1.txt",
  })
  const checkpoint = await git.commit({
    fs: filesystem,
    dir: "/workspace",
    message: "Checkpoint",
    author: { name: "Test", email: "test@example.com" },
  })
  storage.sql.exec("UPDATE app_workspace_vcs SET fork_head = ?", checkpoint)
  const checkpointed = await workspaceGit.versionControl()
  expect(checkpointed.working).toEqual([])
  expect(checkpointed.branch).toHaveLength(2)
  const summary = await workspaceGit.versionControl(false, false)
  expect(summary.branch.every((change) => change.patch === "")).toBe(true)
  expect(summary.branch.map((change) => change.additions)).toEqual(
    checkpointed.branch.map((change) => change.additions)
  )
  expect((await workspaceGit.versionControl()).branch).toEqual(
    checkpointed.branch
  )
  storage.readCount = 0
  await workspaceGit.versionControl()
  expect(storage.readCount).toBe(0)
  await filesystem.writeFile("files/file-2.txt", "later\n")
  const later = await workspaceGit.versionControl()
  expect(later.branch).toEqual(checkpointed.branch)
  expect(later.working.map((change) => change.file)).toEqual([
    "files/file-2.txt",
  ])
})

test("clearing the filesystem invalidates the working revision", async () => {
  const filesystem = new WorkspaceFilesystem(new TestSqlStorage())
  filesystem.initialize()
  const initial = filesystem.workingRevision
  await filesystem.writeFile(".git/config", "config")
  expect(filesystem.workingRevision).toBe(initial)
  await filesystem.writeFile("app.ts", "code")
  expect(filesystem.workingRevision).toBeGreaterThan(initial)
  const written = filesystem.workingRevision
  filesystem.clear()
  expect(filesystem.workingRevision).toBeGreaterThan(written)
})
