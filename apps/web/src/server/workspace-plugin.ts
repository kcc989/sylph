import {
  decodeWorkspaceDeleteFile,
  decodeWorkspaceFilePath,
  decodeWorkspaceListFiles,
  decodeWorkspaceWriteFile,
  WorkspaceDeleteFileJsonSchema,
  WorkspaceFilePathJsonSchema,
  WorkspaceListFilesJsonSchema,
  WorkspaceWriteFileJsonSchema,
} from "@workspace/domain"
import { Plugin } from "@opencode-ai/plugin"

import {
  applyOpenAIOAuthRequest,
  type OpenAIOAuthRequestState,
} from "./opencode-oauth-request"
import {
  WorkspaceFilesystem,
  normalizeWorkspacePath,
} from "./workspace-filesystem"
import { WorkspaceGit } from "./workspace-git"

export const createWorkspacePlugin = (
  filesystem: WorkspaceFilesystem,
  workspaceGit: WorkspaceGit,
  openAIOAuth: OpenAIOAuthRequestState
) =>
  Plugin.define({
    id: "sylph-workspace",
    vcs: { id: "sylph", markers: [".git"] },
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
            const rows = filesystem
              .listWorkingFiles()
              .filter((path) => path.startsWith(prefix))

            return {
              content: rows.length ? rows.join("\n") : "No files found.",
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
            const content = await filesystem.readFile(path, "utf8")
            return {
              content:
                content instanceof Uint8Array
                  ? new TextDecoder().decode(content)
                  : content,
            }
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
            await filesystem.writeFile(path, decoded.content)

            return { content: `Wrote ${path}` }
          },
        })
        draft.add({
          name: "workspace_delete_file",
          description: "Delete a file from the durable Sylph Workspace.",
          input: WorkspaceDeleteFileJsonSchema,
          async execute(input) {
            const decoded = await decodeWorkspaceDeleteFile(input)
            const path = normalizeWorkspacePath(decoded.path)
            await filesystem.unlink(path)
            return { content: `Deleted ${path}` }
          },
        })
      })
      const vcsRegistration = await context.vcs.transform((draft) => {
        draft.add({
          id: "sylph",
          name: "Sylph Workspace fork",
          async info() {
            const vcs = await workspaceGit.versionControl()
            return {
              branch: { current: vcs.currentRef, default: vcs.defaultRef },
            }
          },
          async branches() {
            const vcs = await workspaceGit.versionControl()
            return [vcs.defaultRef]
          },
          async status() {
            const vcs = await workspaceGit.versionControl()
            return vcs.working.map(
              ({ file, status, additions, deletions }) => ({
                file,
                status,
                additions,
                deletions,
              })
            )
          },
          async diff(input) {
            const vcs = await workspaceGit.versionControl()
            return input.mode === "working" ? vcs.working : vcs.branch
          },
        })
        draft.default.set("sylph")
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
      const openAIRequestRegistration = await context.session.hook(
        "model.request",
        (request) => applyOpenAIOAuthRequest(request, openAIOAuth),
        { providerID: "openai" }
      )

      return async () => {
        await Promise.all([
          toolRegistration.dispose(),
          vcsRegistration.dispose(),
          sessionRegistration.dispose(),
          openAIRequestRegistration.dispose(),
        ])
      }
    },
  })
