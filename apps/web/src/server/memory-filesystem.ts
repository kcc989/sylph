import type { WorkspaceGitFilesystem } from "./workspace-filesystem"

type FileEntry = { kind: "file"; data: Uint8Array; modifiedAt: number }
type DirectoryEntry = {
  kind: "directory"
  children: Set<string>
  modifiedAt: number
}
type Entry = FileEntry | DirectoryEntry

const memoryError = (code: string, path: string) => {
  const error = new Error(`${code}: ${path}`)
  Object.defineProperty(error, "code", { value: code })
  return error
}

class MemoryStats {
  readonly #entry: Entry

  constructor(entry: Entry) {
    this.#entry = entry
  }

  get size() {
    return this.#entry.kind === "file" ? this.#entry.data.byteLength : 0
  }

  get mtimeMs() {
    return this.#entry.modifiedAt
  }

  get ctimeMs() {
    return this.#entry.modifiedAt
  }

  get mode() {
    return this.#entry.kind === "file" ? 0o100644 : 0o040000
  }

  isFile() {
    return this.#entry.kind === "file"
  }

  isDirectory() {
    return this.#entry.kind === "directory"
  }

  isSymbolicLink() {
    return false
  }
}

const rootEntry = (): DirectoryEntry => ({
  kind: "directory",
  children: new Set(),
  modifiedAt: Date.now(),
})

export class MemoryFilesystem implements WorkspaceGitFilesystem {
  readonly #entries = new Map<string, Entry>([["/", rootEntry()]])
  readonly promises = {
    readFile: this.readFile.bind(this),
    writeFile: this.writeFile.bind(this),
    unlink: this.unlink.bind(this),
    readdir: this.readdir.bind(this),
    mkdir: this.mkdir.bind(this),
    rmdir: this.rmdir.bind(this),
    stat: this.stat.bind(this),
    lstat: this.stat.bind(this),
    readlink: async (path: string) => {
      throw memoryError("EINVAL", path)
    },
    symlink: async (_target: string, path: string) => {
      throw memoryError("EPERM", path)
    },
  }

  normalize(input: string) {
    const segments: string[] = []
    for (const part of input.split("/")) {
      if (!part || part === ".") continue
      if (part === "..") {
        segments.pop()
      } else {
        segments.push(part)
      }
    }
    return segments.length ? `/${segments.join("/")}` : "/"
  }

  parent(input: string) {
    const path = this.normalize(input)
    if (path === "/") return "/"
    const parts = path.split("/").filter(Boolean)
    parts.pop()
    return parts.length ? `/${parts.join("/")}` : "/"
  }

  basename(input: string) {
    return this.normalize(input).split("/").filter(Boolean).pop() ?? ""
  }

  entry(input: string) {
    const entry = this.#entries.get(this.normalize(input))
    if (!entry) throw memoryError("ENOENT", input)
    return entry
  }

  directory(input: string) {
    const entry = this.entry(input)
    if (entry.kind !== "directory") throw memoryError("ENOTDIR", input)
    return entry
  }

  async mkdir(input: string, option?: { recursive?: boolean } | number) {
    const path = this.normalize(input)
    if (path === "/") return
    const parent = this.parent(path)
    const recursive = option instanceof Object && option.recursive
    if (!this.#entries.has(parent)) {
      if (!recursive) throw memoryError("ENOENT", parent)
      await this.mkdir(parent, { recursive: true })
    }
    if (this.#entries.has(path)) return
    this.#entries.set(path, {
      kind: "directory",
      children: new Set(),
      modifiedAt: Date.now(),
    })
    this.directory(parent).children.add(this.basename(path))
  }

  clear() {
    this.#entries.clear()
    this.#entries.set("/", rootEntry())
  }

  async writeFile(input: string, value: string | Uint8Array | ArrayBuffer) {
    const path = this.normalize(input)
    await this.mkdir(this.parent(path), { recursive: true })
    const data =
      value instanceof Uint8Array
        ? value
        : value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new TextEncoder().encode(value)
    this.#entries.set(path, { kind: "file", data, modifiedAt: Date.now() })
    this.directory(this.parent(path)).children.add(this.basename(path))
  }

  async readFile(input: string, option?: string | { encoding?: string }) {
    const entry = this.entry(input)
    if (entry.kind !== "file") throw memoryError("EISDIR", input)
    const encoding = option instanceof Object ? option.encoding : option
    return encoding ? new TextDecoder().decode(entry.data) : entry.data
  }

  async readdir(input: string) {
    return [...this.directory(input).children].sort()
  }

  async unlink(input: string) {
    const path = this.normalize(input)
    const entry = this.entry(path)
    if (entry.kind !== "file") throw memoryError("EISDIR", input)
    this.#entries.delete(path)
    this.directory(this.parent(path)).children.delete(this.basename(path))
  }

  async rmdir(input: string) {
    const path = this.normalize(input)
    const entry = this.directory(path)
    if (entry.children.size) throw memoryError("ENOTEMPTY", input)
    this.#entries.delete(path)
    this.directory(this.parent(path)).children.delete(this.basename(path))
  }

  async stat(input: string) {
    return new MemoryStats(this.entry(input))
  }
}
