import {
  decodeWorkspaceFilePath,
  decodeWorkspaceListFiles,
  decodeWorkspaceWriteFile,
  WorkspaceFilePathJsonSchema,
  WorkspaceListFilesJsonSchema,
  WorkspaceWriteFileJsonSchema,
} from "@workspace/domain"
import { Plugin } from "@opencode-ai/plugin"

const normalizeWorkspacePath = (value: string) => {
  const path = value.trim().replaceAll("\\", "/").replace(/^\.\//, "")
  const segments = path.split("/")

  if (
    !path ||
    path.startsWith("/") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Use a relative file path inside the workspace")
  }

  return path
}

export const createWorkspacePlugin = (storage: DurableObjectStorage) =>
  Plugin.define({
    id: "sylph-workspace",
    async setup(context) {
      const toolRegistration = await context.tool.transform((draft) => {
        draft.add({
          name: "workspace_list_files",
          description:
            "List files in the durable Sylph workspace. Use this instead of shell or local filesystem tools.",
          input: WorkspaceListFilesJsonSchema,
          async execute(input) {
            const { directory = "" } = await decodeWorkspaceListFiles(input)
            const prefix = directory
              ? `${normalizeWorkspacePath(directory).replace(/\/$/, "")}/`
              : ""
            const rows = storage.sql
              .exec<{ path: string }>(
                "SELECT path FROM app_workspace_file WHERE path LIKE ? ORDER BY path",
                `${prefix}%`
              )
              .toArray()

            return {
              content: rows.length
                ? rows.map((row) => row.path).join("\n")
                : "No files found.",
            }
          },
        })
        draft.add({
          name: "workspace_read_file",
          description:
            "Read a UTF-8 text file from the durable Sylph workspace.",
          input: WorkspaceFilePathJsonSchema,
          async execute(input) {
            const decoded = await decodeWorkspaceFilePath(input)
            const path = normalizeWorkspacePath(decoded.path)
            const row = storage.sql
              .exec<{ content: string }>(
                "SELECT content FROM app_workspace_file WHERE path = ?",
                path
              )
              .one()

            if (!row) {
              throw new Error(`File not found: ${path}`)
            }

            return { content: row.content }
          },
        })
        draft.add({
          name: "workspace_write_file",
          description:
            "Create or replace a UTF-8 text file in the durable Sylph workspace.",
          input: WorkspaceWriteFileJsonSchema,
          async execute(input) {
            const decoded = await decodeWorkspaceWriteFile(input)
            const path = normalizeWorkspacePath(decoded.path)
            storage.sql.exec(
              `INSERT INTO app_workspace_file (path, content, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(path) DO UPDATE SET
                 content = excluded.content,
                 updated_at = excluded.updated_at`,
              path,
              decoded.content,
              Date.now()
            )

            return { content: `Wrote ${path}` }
          },
        })
      })
      const sessionRegistration = await context.session.hook(
        "context",
        (session) => {
          session.system.push({
            type: "text",
            text: "You are coding inside a Cloudflare Durable Object. Use workspace_list_files, workspace_read_file, and workspace_write_file for all source work. The durable workspace filesystem is authoritative during the session. Do not call shell, PTY, or local filesystem tools because they are unavailable in Workerd. Explain when install, build, test, or deployment work must be delegated to Cloudflare CI.",
          })
        }
      )

      return async () => {
        await Promise.all([
          toolRegistration.dispose(),
          sessionRegistration.dispose(),
        ])
      }
    },
  })
