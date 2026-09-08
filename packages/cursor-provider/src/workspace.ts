import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, resolve } from "node:path"
import type { WorkspaceCommandFile } from "@workspace/domain/workspace-command"

export const syncCursorWorkspace = async (
  root: string,
  files: readonly WorkspaceCommandFile[]
) => {
  const paths = new Set<string>()
  const entries = files.map((file) => {
    const segments = file.path.split("/")
    if (
      isAbsolute(file.path) ||
      segments.some(
        (part) => !part || part === "." || part === ".." || part === ".git"
      ) ||
      file.path.includes("\\") ||
      file.path.includes("\0")
    )
      throw new Error("Invalid Cursor workspace path")
    if (paths.has(file.path)) throw new Error("Duplicate Cursor workspace path")
    paths.add(file.path)
    return {
      path: resolve(root, file.path),
      content: Buffer.from(file.content, "base64"),
    }
  })
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  for (const entry of entries) {
    await mkdir(dirname(entry.path), { recursive: true })
    await writeFile(entry.path, entry.content)
  }
}
