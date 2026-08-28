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

export const selectWorkspaceVcs = (draft: {
  readonly default?: { set(selection: string): void }
}) => draft.default?.set("sylph")

export const workspaceToolOptions = {
  codemode: false,
} satisfies { readonly codemode: false }

export const workspaceWriteToolOptions = {
  codemode: false,
  permission: "workspace_write_file",
} satisfies { readonly codemode: false; readonly permission: string }

export const workspaceDeleteToolOptions = {
  codemode: false,
  permission: "workspace_delete_file",
} satisfies { readonly codemode: false; readonly permission: string }

export type WorkspaceMutationPermissionRequest = {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly toolCallID: string
  readonly action: "workspace_write_file" | "workspace_delete_file"
  readonly path: string
}

export type WorkspaceMutationPermissionRequester = (
  request: WorkspaceMutationPermissionRequest
) => Promise<{
  readonly id: string
  readonly effect: "allow" | "deny" | "ask"
}>

export const createWorkspacePermissionBridge = () => {
  let requester: WorkspaceMutationPermissionRequester | undefined
  const pending = new Map<string, (effect: "allow" | "deny") => void>()

  return {
    connect(nextRequester: WorkspaceMutationPermissionRequester) {
      requester = nextRequester
    },
    async request(request: WorkspaceMutationPermissionRequest) {
      if (!requester) {
        throw new Error("Workspace permission service is not ready")
      }

      const decision = await requester(request)
      const effect =
        decision.effect === "ask"
          ? await new Promise<"allow" | "deny">((resolve) =>
              pending.set(decision.id, resolve)
            )
          : decision.effect

      if (effect !== "allow") {
        throw new Error(`Permission denied for ${request.action}`)
      }
    },
    reply(requestId: string, reply: "once" | "always" | "reject") {
      const resolve = pending.get(requestId)

      if (!resolve) return

      pending.delete(requestId)
      resolve(reply === "reject" ? "deny" : "allow")
    },
  }
}

export type WorkspacePermissionBridge = ReturnType<
  typeof createWorkspacePermissionBridge
>

export const workspaceMutationPermissions = [
  {
    action: "workspace_write_file",
    resource: "*",
    effect: "ask",
  },
  {
    action: "workspace_delete_file",
    resource: "*",
    effect: "ask",
  },
] satisfies ReadonlyArray<{
  readonly action: string
  readonly resource: string
  readonly effect: "ask"
}>

export type WorkspacePermissionEvaluation = {
  readonly action: string
  effect: "allow" | "ask" | "deny"
  message?: string
}

export const requireWorkspaceMutationPermission = (
  evaluation: WorkspacePermissionEvaluation
) => {
  if (
    evaluation.action !== "workspace_write_file" &&
    evaluation.action !== "workspace_delete_file"
  ) {
    return
  }

  evaluation.effect = "ask"
  evaluation.message = "Allow the assistant to change this Workspace?"
}

export const createWorkspacePlugin = (
  filesystem: WorkspaceFilesystem,
  workspaceGit: WorkspaceGit,
  openAIOAuth: OpenAIOAuthRequestState,
  permissionBridge: WorkspacePermissionBridge
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
          options: workspaceToolOptions,
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
          options: workspaceToolOptions,
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
          options: workspaceWriteToolOptions,
          async execute(input, context) {
            const decoded = await decodeWorkspaceWriteFile(input)
            const path = normalizeWorkspacePath(decoded.path)
            await permissionBridge.request({
              sessionID: context.sessionID,
              agent: context.agent,
              messageID: context.messageID,
              toolCallID: context.id,
              action: "workspace_write_file",
              path,
            })
            await filesystem.writeFile(path, decoded.content)

            return { content: `Wrote ${path}` }
          },
        })
        draft.add({
          name: "workspace_delete_file",
          description: "Delete a file from the durable Sylph Workspace.",
          input: WorkspaceDeleteFileJsonSchema,
          options: workspaceDeleteToolOptions,
          async execute(input, context) {
            const decoded = await decodeWorkspaceDeleteFile(input)
            const path = normalizeWorkspacePath(decoded.path)
            await permissionBridge.request({
              sessionID: context.sessionID,
              agent: context.agent,
              messageID: context.messageID,
              toolCallID: context.id,
              action: "workspace_delete_file",
              path,
            })
            await filesystem.unlink(path)
            return { content: `Deleted ${path}` }
          },
        })
      })
      const agentRegistration = await context.agent.transform((draft) => {
        draft.update("build", (agent) => {
          agent.permissions.push(...workspaceMutationPermissions)
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
        selectWorkspaceVcs(draft)
      })
      const permissionRegistration = await context.permission.hook(
        "evaluate",
        requireWorkspaceMutationPermission
      )
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
          agentRegistration.dispose(),
          permissionRegistration.dispose(),
          vcsRegistration.dispose(),
          sessionRegistration.dispose(),
          openAIRequestRegistration.dispose(),
        ])
      }
    },
  })
