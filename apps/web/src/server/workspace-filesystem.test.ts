import { describe, expect, test } from "bun:test"
import { Database, type SQLQueryBindings } from "bun:sqlite"
import git from "isomorphic-git"
import { WorkspaceGit, checkoutRepairCommit } from "./workspace-git"

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

test("checks reuse a manual checkpoint whose Git push is still in flight", async () => {
  const storage = new TestSqlStorage()
  const filesystem = new WorkspaceFilesystem(storage)
  filesystem.initialize()
  await git.init({ fs: filesystem, dir: "/workspace", defaultBranch: "main" })
  await filesystem.writeFile("proof.txt", "before")
  await git.add({ fs: filesystem, dir: "/workspace", filepath: "proof.txt" })
  const base = await git.commit({
    fs: filesystem,
    dir: "/workspace",
    message: "Baseline",
    author: { name: "Test", email: "test@example.com" },
  })
  let remoteHead = base
  let pushes = 0
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const packet = (value: string) =>
    `${(new TextEncoder().encode(value).byteLength + 4).toString(16).padStart(4, "0")}${value}`
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (request.method === "GET")
        return new Response(
          `${packet("# service=git-receive-pack\n")}0000${packet(`${remoteHead} refs/heads/main\0report-status side-band-64k\n`)}0000`,
          {
            headers: {
              "Content-Type": "application/x-git-receive-pack-advertisement",
            },
          }
        )
      const command =
        new TextDecoder()
          .decode(await request.arrayBuffer())
          .slice(4)
          .split("\n")[0] ?? ""
      const [previous, next] = command.split(" ")
      if (!previous || !next) throw new Error("Missing Git ref update")
      pushes++
      started.resolve()
      await release.promise
      const accepted = previous === remoteHead
      if (accepted) remoteHead = next
      return new Response(
        `${packet(`\x01${packet("unpack ok\n")}${packet(accepted ? "ok refs/heads/main\n" : "ng refs/heads/main stale ref\n")}0000`)}0000`,
        { headers: { "Content-Type": "application/x-git-receive-pack-result" } }
      )
    },
  })
  try {
    const workspaceGit = new WorkspaceGit(
      storage,
      {
        get: async () => ({
          defaultBranch: "main",
          createToken: async () => ({ plaintext: "fixture" }),
        }),
      },
      filesystem
    )
    workspaceGit.initialize()
    storage.sql.exec(
      "INSERT INTO app_workspace_vcs (singleton, repository_name, repository_remote, project_repository_name, project_repository_remote, default_ref, base_commit, fork_head, project_head, sync_status, merge_status) VALUES (1, 'workspace', ?, 'project', ?, 'main', ?, ?, ?, 'ready', 'unreviewed')",
      server.url.href,
      server.url.href,
      base,
      base,
      base
    )
    await filesystem.writeFile("proof.txt", "after")
    const manual = workspaceGit.checkpoint({
      idempotencyKey: "manual",
      message: "Manual checkpoint",
    })
    await started.promise
    const checks = workspaceGit.checkpointForOperation("Check checkpoint")
    const preview = workspaceGit.checkpointForOperation("Preview checkpoint")
    await Bun.sleep(50)
    release.resolve()
    const [saved, checked, previewed] = await Promise.all([
      manual,
      checks,
      preview,
    ])
    expect(checked).toEqual(saved.checkpoint)
    expect(previewed).toEqual(saved.checkpoint)
    expect(remoteHead).toBe(saved.checkpoint.commit)
    expect(pushes).toBe(1)
    expect(workspaceGit.checkpoints()).toHaveLength(1)
    await expect(
      workspaceGit.checkpoint({
        idempotencyKey: "empty",
        message: "No changes",
      })
    ).rejects.toThrow("no changes")
    expect(remoteHead).toBe(
      (await workspaceGit.checkpointForOperation("After failure")).commit
    )
  } finally {
    release.resolve()
    server.stop(true)
  }
})

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

test("command reconciliation saves binary edits and deletes while preserving concurrent unrelated work", async () => {
  const fs = new WorkspaceFilesystem(new TestSqlStorage())
  fs.initialize()
  await fs.writeFile("old.txt", "before")
  await fs.writeFile("deleted.txt", "remove")
  await fs.writeFile(".git/HEAD", "ref: refs/heads/main")
  const before = fs.commandFiles()
  await fs.writeFile("editor.txt", "concurrent")
  fs.applyCommandFiles(before, [
    { path: "old.txt", content: Buffer.from([0, 255, 12]).toString("base64") },
  ])
  expect(await fs.readFile("old.txt")).toEqual(new Uint8Array([0, 255, 12]))
  expect(fs.listWorkingFiles()).toEqual(["editor.txt", "old.txt"])
  expect(await fs.readFile(".git/HEAD", "utf8")).toBe("ref: refs/heads/main")
})

test("command reconciliation rejects overlapping edits before changing any files", async () => {
  const fs = new WorkspaceFilesystem(new TestSqlStorage())
  fs.initialize()
  await fs.writeFile("first.txt", "original")
  await fs.writeFile("second.txt", "original")
  const before = fs.commandFiles()
  await fs.writeFile("second.txt", "editor version")
  const after = before.map((file) => ({
    path: file.path,
    content: Buffer.from("shell version").toString("base64"),
  }))
  expect(() => fs.applyCommandFiles(before, after)).toThrow("conflict")
  expect(await fs.readFile("first.txt", "utf8")).toBe("original")
  expect(await fs.readFile("second.txt", "utf8")).toBe("editor version")
  expect(() =>
    fs.applyCommandFiles(before, [{ path: "../escape", content: "" }])
  ).toThrow()
})

test("repair checkout uses deployed files when Project main has advanced", async () => {
  const filesystem = new WorkspaceFilesystem(new TestSqlStorage())
  filesystem.initialize()
  await git.init({ fs: filesystem, dir: "/workspace", defaultBranch: "main" })
  await filesystem.writeFile("app.txt", "deployed version")
  await git.add({ fs: filesystem, dir: "/workspace", filepath: "app.txt" })
  const deployed = await git.commit({
    fs: filesystem,
    dir: "/workspace",
    message: "deployed",
    author: { name: "Test", email: "test@example.com" },
  })
  await filesystem.writeFile("app.txt", "newer Project version")
  await git.add({ fs: filesystem, dir: "/workspace", filepath: "app.txt" })
  const latest = await git.commit({
    fs: filesystem,
    dir: "/workspace",
    message: "advanced",
    author: { name: "Test", email: "test@example.com" },
  })
  await checkoutRepairCommit(filesystem, "repair-incident", deployed)
  expect(await filesystem.readFile("app.txt", "utf8")).toBe("deployed version")
  expect(
    await git.resolveRef({ fs: filesystem, dir: "/workspace", ref: "HEAD" })
  ).toBe(deployed)
  expect(
    await git.resolveRef({ fs: filesystem, dir: "/workspace", ref: "main" })
  ).toBe(latest)
  await expect(
    checkoutRepairCommit(filesystem, "missing-repair", "f".repeat(40))
  ).rejects.toThrow()
  expect(await git.currentBranch({ fs: filesystem, dir: "/workspace" })).toBe(
    "repair-incident"
  )
})

test("Cursor snapshots exclude Git objects without losing working files", async () => {
  const filesystem = new WorkspaceFilesystem(new TestSqlStorage())
  filesystem.initialize()
  await filesystem.writeFile(".git/objects/fixture", "git object")
  await filesystem.writeFile("package.json", "{}")
  expect(filesystem.commandFiles(false)).toEqual([
    { path: "package.json", content: Buffer.from("{}").toString("base64") },
  ])
  expect(filesystem.commandFiles().map((file) => file.path)).toEqual([
    ".git/objects/fixture",
    "package.json",
  ])
})
