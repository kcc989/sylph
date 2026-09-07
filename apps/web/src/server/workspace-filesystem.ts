import type { PromiseFsClient } from "isomorphic-git"
import {
  WorkspaceCommandConflict,
  type WorkspaceCommandFile,
} from "@workspace/domain"

const workspaceRoot = "/workspace"
const defaultFileLimit = 5 * 1024 * 1024
const defaultRepositoryLimit = 50 * 1024 * 1024

interface WorkspaceSqlCursor<Row> {
  toArray(): Row[]
}

interface WorkspaceSql {
  exec<Row extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: SqlStorageValue[]
  ): WorkspaceSqlCursor<Row>
}

export interface WorkspaceStorage {
  transactionSync?<T>(callback: () => T): T
  sql: WorkspaceSql
}

export interface WorkspaceGitFilesystem extends PromiseFsClient {
  readonly workingRevision?: number
  clear(): void
  writeFile(
    path: string,
    content: string | Uint8Array | ArrayBuffer
  ): Promise<void>
}
type EncodingOption = string | { encoding?: string | null } | null | undefined
type FileContentRow = {
  [key: string]: SqlStorageValue
  path: string
  content: SqlStorageValue
}

const filesystemError = (code: string, path: string) => {
  const error = new Error(`${code}: ${path}`)
  Object.defineProperty(error, "code", { value: code })
  return error
}

export const workspaceFilesystemErrorCode = (cause: unknown) =>
  cause instanceof Error
    ? Object.getOwnPropertyDescriptor(cause, "code")?.value
    : undefined

const bytes = (value: string | Uint8Array | ArrayBuffer) => {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return new TextEncoder().encode(value)
}

const contentBytes = (value: SqlStorageValue) => {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  return new TextEncoder().encode(String(value))
}

const directoriesFor = (path: string) => {
  const segments = path.split("/").filter(Boolean)
  return segments
    .slice(0, -1)
    .map((_, index) => segments.slice(0, index + 1).join("/"))
}

export const normalizeWorkspacePath = (value: string) => {
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/+/g, "/")
  const relative = normalized.startsWith(`${workspaceRoot}/`)
    ? normalized.slice(workspaceRoot.length + 1)
    : normalized === workspaceRoot || normalized === "/"
      ? ""
      : normalized.replace(/^\.\//, "")
  const segments = relative
    .split("/")
    .filter((segment) => segment && segment !== ".")

  if (
    normalized.includes("\0") ||
    (normalized !== "/" &&
      !normalized.startsWith(workspaceRoot) &&
      normalized.startsWith("/")) ||
    segments.some((segment) => segment === "..")
  ) {
    throw filesystemError("EINVAL", value)
  }

  return segments.join("/")
}

export class WorkspaceFilesystem implements WorkspaceGitFilesystem {
  readonly promises
  get workingRevision() {
    return (
      this.#storage.sql
        .exec<{ revision: number }>(
          "SELECT COALESCE(MAX(sequence), 0) AS revision FROM app_filesystem_event"
        )
        .toArray()[0]?.revision ?? 0
    )
  }

  readonly #storage: WorkspaceStorage
  readonly #fileLimit: number
  readonly #repositoryLimit: number

  constructor(
    storage: WorkspaceStorage,
    limits: { file?: number; repository?: number } = {}
  ) {
    this.#storage = storage
    this.#fileLimit = limits.file ?? defaultFileLimit
    this.#repositoryLimit = limits.repository ?? defaultRepositoryLimit
    this.promises = {
      readFile: this.readFile.bind(this),
      writeFile: this.writeFile.bind(this),
      unlink: this.unlink.bind(this),
      readdir: this.readdir.bind(this),
      mkdir: this.mkdir.bind(this),
      rmdir: this.rmdir.bind(this),
      stat: this.stat.bind(this),
      lstat: this.stat.bind(this),
      readlink: async (path: string) => {
        throw filesystemError("EINVAL", path)
      },
      symlink: async (_target: string, path: string) => {
        throw filesystemError("EPERM", path)
      },
      chmod: async () => undefined,
    }
  }

  initialize() {
    this.#storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS app_workspace_file (path TEXT PRIMARY KEY NOT NULL, content BLOB NOT NULL, size INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)"
    )
    this.#storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS app_filesystem_event (sequence INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL)"
    )
    this.#storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS app_workspace_directory (path TEXT PRIMARY KEY NOT NULL, updated_at INTEGER NOT NULL)"
    )
    this.#storage.sql.exec(
      "INSERT OR IGNORE INTO app_workspace_directory (path, updated_at) VALUES ('', ?)",
      Date.now()
    )
  }

  async readFile(pathValue: string): Promise<Uint8Array>
  async readFile(
    pathValue: string,
    option: EncodingOption
  ): Promise<string | Uint8Array>
  async readFile(pathValue: string, option?: EncodingOption) {
    const data = this.#readBytes(pathValue)
    const encoding = option instanceof Object ? option.encoding : option
    return encoding ? new TextDecoder().decode(data) : data
  }

  #readBytes(pathValue: string) {
    const path = normalizeWorkspacePath(pathValue)
    const row = this.#storage.sql
      .exec<{ [key: string]: SqlStorageValue; content: SqlStorageValue }>(
        "SELECT content FROM app_workspace_file WHERE path = ?",
        path
      )
      .toArray()[0]

    if (!row) throw filesystemError("ENOENT", pathValue)
    return contentBytes(row.content)
  }

  async writeFile(
    pathValue: string,
    value: string | Uint8Array | ArrayBuffer,
    option?: EncodingOption
  ) {
    this.#writeFile(pathValue, value, option)
  }

  #writeFile(
    pathValue: string,
    value: string | Uint8Array | ArrayBuffer,
    _option?: EncodingOption
  ) {
    const path = normalizeWorkspacePath(pathValue)
    if (!path) throw filesystemError("EISDIR", pathValue)
    const data = bytes(value)
    if (data.byteLength > this.#fileLimit) {
      throw filesystemError("EFBIG", pathValue)
    }

    const current = this.#storage.sql
      .exec<{ size: number }>(
        "SELECT size FROM app_workspace_file WHERE path = ?",
        path
      )
      .toArray()[0]?.size
    const total =
      this.#storage.sql
        .exec<{ size: number }>(
          "SELECT COALESCE(SUM(size), 0) AS size FROM app_workspace_file"
        )
        .toArray()[0]?.size ?? 0

    if (total - (current ?? 0) + data.byteLength > this.#repositoryLimit) {
      throw filesystemError("ENOSPC", pathValue)
    }

    for (const directory of directoriesFor(path)) {
      this.#storage.sql.exec(
        "INSERT OR IGNORE INTO app_workspace_directory (path, updated_at) VALUES (?, ?)",
        directory,
        Date.now()
      )
    }
    this.#storage.sql.exec(
      "INSERT INTO app_workspace_file (path, content, size, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET content = excluded.content, size = excluded.size, updated_at = excluded.updated_at",
      path,
      new Uint8Array(data).buffer,
      data.byteLength,
      Date.now()
    )
    this.#emit(current === undefined ? "created" : "changed", path)
  }

  async unlink(pathValue: string) {
    this.#unlink(pathValue)
  }

  #unlink(pathValue: string) {
    const path = normalizeWorkspacePath(pathValue)
    const existing = this.#storage.sql
      .exec<{ path: string }>(
        "SELECT path FROM app_workspace_file WHERE path = ?",
        path
      )
      .toArray()[0]
    if (!existing) throw filesystemError("ENOENT", pathValue)
    this.#storage.sql.exec(
      "DELETE FROM app_workspace_file WHERE path = ?",
      path
    )
    this.#emit("deleted", path)
  }

  async readdir(pathValue: string) {
    const path = normalizeWorkspacePath(pathValue)
    const prefix = path ? `${path}/` : ""
    const rows = this.#storage.sql
      .exec<{ path: string }>(
        "SELECT path FROM app_workspace_file WHERE path LIKE ? ORDER BY path",
        `${prefix}%`
      )
      .toArray()
    const directories = this.#storage.sql
      .exec<{ path: string }>(
        "SELECT path FROM app_workspace_directory WHERE path LIKE ? ORDER BY path",
        `${prefix}%`
      )
      .toArray()
    const children = new Set<string>()
    for (const row of [...rows, ...directories]) {
      if (row.path === path) continue
      const child = row.path.slice(prefix.length).split("/")[0]
      if (child) children.add(child)
    }
    if (path && children.size === 0) {
      const file = this.#storage.sql
        .exec<{ path: string }>(
          "SELECT path FROM app_workspace_file WHERE path = ?",
          path
        )
        .toArray()[0]
      if (file) throw filesystemError("ENOTDIR", pathValue)
      const directory = this.#storage.sql
        .exec<{ path: string }>(
          "SELECT path FROM app_workspace_directory WHERE path = ?",
          path
        )
        .toArray()[0]
      if (!directory) throw filesystemError("ENOENT", pathValue)
    }
    return [...children].sort()
  }

  async mkdir(pathValue: string, option?: { recursive?: boolean } | number) {
    const path = normalizeWorkspacePath(pathValue)
    if (!path) return
    const parent = path.split("/").slice(0, -1).join("/")
    const parentExists = this.#storage.sql
      .exec<{ path: string }>(
        "SELECT path FROM app_workspace_directory WHERE path = ?",
        parent
      )
      .toArray()[0]
    const recursive = option instanceof Object && option.recursive
    if (!parentExists && !recursive) throw filesystemError("ENOENT", pathValue)
    const directories = recursive
      ? [...directoriesFor(`${path}/entry`), path]
      : [path]
    for (const directory of directories) {
      this.#storage.sql.exec(
        "INSERT OR IGNORE INTO app_workspace_directory (path, updated_at) VALUES (?, ?)",
        directory,
        Date.now()
      )
    }
  }

  async rmdir(pathValue: string) {
    const path = normalizeWorkspacePath(pathValue)
    const children = await this.readdir(pathValue)
    if (children.length) throw filesystemError("ENOTEMPTY", pathValue)
    if (!path) throw filesystemError("EBUSY", pathValue)
    this.#storage.sql.exec(
      "DELETE FROM app_workspace_directory WHERE path = ?",
      path
    )
  }

  async stat(pathValue: string) {
    const path = normalizeWorkspacePath(pathValue)
    const row = path
      ? this.#storage.sql
          .exec<{ size: number; updatedAt: number }>(
            "SELECT size, updated_at AS updatedAt FROM app_workspace_file WHERE path = ?",
            path
          )
          .toArray()[0]
      : undefined
    const child = path
      ? this.#storage.sql
          .exec<{ path: string }>(
            "SELECT path FROM app_workspace_directory WHERE path = ? LIMIT 1",
            path
          )
          .toArray()[0]
      : { path: "" }

    if (!row && !child) throw filesystemError("ENOENT", pathValue)
    const directory = !row
    const timestamp = row?.updatedAt ?? 0
    return {
      ctimeMs: timestamp,
      mtimeMs: timestamp,
      ctimeSeconds: Math.floor(timestamp / 1000),
      ctimeNanoseconds: 0,
      mtimeSeconds: Math.floor(timestamp / 1000),
      mtimeNanoseconds: 0,
      dev: 0,
      ino: 0,
      mode: directory ? 0o040755 : 0o100644,
      uid: 0,
      gid: 0,
      size: row?.size ?? 0,
      isFile: () => !directory,
      isDirectory: () => directory,
      isSymbolicLink: () => false,
    }
  }

  listWorkingFiles(directory = "") {
    const normalized = normalizeWorkspacePath(directory)
    const prefix = normalized ? `${normalized}/` : ""
    return this.#storage.sql
      .exec<{ path: string }>(
        "SELECT path FROM app_workspace_file WHERE path NOT LIKE '.git/%' ORDER BY path"
      )
      .toArray()
      .map((row) => row.path)
      .filter((path) => path.startsWith(prefix))
  }

  commandFiles(): WorkspaceCommandFile[] {
    return this.#storage.sql
      .exec<FileContentRow>(
        "SELECT path, content FROM app_workspace_file ORDER BY path"
      )
      .toArray()
      .map((row) => ({
        path: row.path,
        content: Buffer.from(contentBytes(row.content)).toString("base64"),
      }))
  }

  applyCommandFiles(
    before: readonly WorkspaceCommandFile[],
    after: readonly WorkspaceCommandFile[]
  ) {
    const original = new Map(
      before
        .filter((file) => !file.path.startsWith(".git/"))
        .map((file) => [file.path, file.content])
    )
    const current = new Map(
      this.commandFiles().map((file) => [file.path, file.content])
    )
    const next = new Map<string, string>()
    for (const file of after) {
      const path = normalizeWorkspacePath(file.path)
      if (
        !path ||
        path !== file.path ||
        path === ".git" ||
        path.startsWith(".git/") ||
        next.has(path)
      ) {
        throw new WorkspaceCommandConflict({
          message: "Invalid command output path",
        })
      }
      next.set(path, file.content)
    }
    const changes = [...new Set([...original.keys(), ...next.keys()])].filter(
      (path) => original.get(path) !== next.get(path)
    )
    for (const path of changes) {
      if (
        current.get(path) !== original.get(path) &&
        current.get(path) !== next.get(path)
      ) {
        throw new WorkspaceCommandConflict({
          message: `Command changes conflict with a newer edit to ${path}. Sandbox files are retained.`,
        })
      }
    }
    const merged = new Map(current)
    for (const path of changes) {
      const content = next.get(path)
      if (content === undefined) merged.delete(path)
      else merged.set(path, content)
    }
    let total = 0
    for (const content of merged.values()) {
      const length = Buffer.from(content, "base64").length
      if (length > this.#fileLimit) throw filesystemError("EFBIG", "/workspace")
      total += length
    }
    if (total > this.#repositoryLimit)
      throw filesystemError("ENOSPC", "/workspace")
    const delta = (path: string) =>
      Buffer.from(next.get(path) ?? "", "base64").length -
      Buffer.from(current.get(path) ?? "", "base64").length
    changes.sort((left, right) => delta(left) - delta(right))
    const apply = () => {
      for (const path of changes) {
        const content = next.get(path)
        if (current.get(path) === content) continue
        if (content === undefined) this.#unlink(path)
        else this.#writeFile(path, Buffer.from(content, "base64"))
      }
    }
    if (this.#storage.transactionSync) this.#storage.transactionSync(apply)
    else apply()
  }

  clear() {
    this.#emit("cleared", "")
    this.#storage.sql.exec("DELETE FROM app_workspace_file")
    this.#storage.sql.exec(
      "DELETE FROM app_workspace_directory WHERE path <> ''"
    )
  }

  #emit(kind: string, path: string) {
    if (path === ".git" || path.startsWith(".git/")) return
    this.#storage.sql.exec(
      "INSERT INTO app_filesystem_event (kind, path, created_at) VALUES (?, ?, ?)",
      kind,
      path,
      Date.now()
    )
  }
}
