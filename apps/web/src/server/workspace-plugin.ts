import { openRouterErrorResponse } from "./openrouter-response"
import {
  SkillResourceJsonSchema,
  type WorkspaceBrowserResult,
  WorkspaceBrowserToolOutput,
  WorkspaceBrowserToolJsonSchema,
  type WorkspaceCheckpointResult,
  WorkspaceCheckpointToolJsonSchema,
  WorkspaceCheckStatusToolJsonSchema,
  type WorkspaceCheckRun,
  WorkspaceDeleteFileJsonSchema,
  type WorkspaceDiffResult,
  type WorkspaceDiffScope,
  WorkspaceDiffToolJsonSchema,
  WorkspaceFilePathJsonSchema,
  WorkspaceListFilesJsonSchema,
  type WorkspaceMergeRequest,
  WorkspaceMergeToolJsonSchema,
  type WorkspacePreviewResult,
  WorkspacePreviewToolJsonSchema,
  type WorkspaceProductionStatus,
  WorkspaceProductionToolJsonSchema,
  WorkspaceRunChecksToolJsonSchema,
  WorkspaceSyncToolJsonSchema,
  type WorkspaceSyncResult,
  WorkspaceWriteFileJsonSchema,
  WorkspaceEditFileJsonSchema,
  WorkspaceEditFileInput,
  SkillResourceInput,
  WorkspaceBrowserToolInput,
  WorkspaceCheckStatusToolInput,
  WorkspaceCheckpointToolInput,
  WorkspaceDeleteFileInput,
  WorkspaceDiffToolInput,
  WorkspaceFilePathInput,
  WorkspaceListFilesInput,
  WorkspaceMergeToolInput,
  WorkspacePreviewToolInput,
  WorkspaceProductionToolInput,
  WorkspaceRunChecksToolInput,
  WorkspaceSyncToolInput,
  WorkspaceWriteFileInput,
} from "@workspace/domain"
import { Plugin } from "@opencode-ai/plugin"
import { Skill } from "@opencode-ai/schema/skill"
import { AbsolutePath } from "@opencode-ai/schema/schema"

import {
  applyOpenAIOAuthRequest,
  type OpenAIOAuthRequestState,
} from "./opencode-oauth-request"
import {
  WorkspaceFilesystem,
  normalizeWorkspacePath,
} from "./workspace-filesystem"
import { WorkspaceGit } from "./workspace-git"
import { Schema } from "effect"

import {
  runtimeSkillContent,
  runtimeSkillPolicy,
  type WorkspaceSkillRegistry,
} from "./workspace-skills"

const decodeSkillResourceInputPromise =
  Schema.decodeUnknownPromise(SkillResourceInput)
const decodeWorkspaceBrowserToolInput = Schema.decodeUnknownPromise(
  WorkspaceBrowserToolInput
)
const decodeWorkspaceCheckStatusToolInput = Schema.decodeUnknownPromise(
  WorkspaceCheckStatusToolInput
)
const decodeWorkspaceCheckpointToolInput = Schema.decodeUnknownPromise(
  WorkspaceCheckpointToolInput
)
const decodeWorkspaceDeleteFile = Schema.decodeUnknownPromise(
  WorkspaceDeleteFileInput
)
const decodeWorkspaceDiffToolInput = Schema.decodeUnknownPromise(
  WorkspaceDiffToolInput
)
const decodeWorkspaceFilePath = Schema.decodeUnknownPromise(
  WorkspaceFilePathInput
)
const decodeWorkspaceListFiles = Schema.decodeUnknownPromise(
  WorkspaceListFilesInput
)
const decodeWorkspaceMergeToolInput = Schema.decodeUnknownPromise(
  WorkspaceMergeToolInput
)
const decodeWorkspacePreviewToolInput = Schema.decodeUnknownPromise(
  WorkspacePreviewToolInput
)
const decodeWorkspaceProductionToolInput = Schema.decodeUnknownPromise(
  WorkspaceProductionToolInput
)
const decodeWorkspaceRunChecksToolInput = Schema.decodeUnknownPromise(
  WorkspaceRunChecksToolInput
)
const decodeWorkspaceSyncToolInput = Schema.decodeUnknownPromise(
  WorkspaceSyncToolInput
)
const decodeWorkspaceWriteFile = Schema.decodeUnknownPromise(
  WorkspaceWriteFileInput
)
const decodeWorkspaceEditFile = Schema.decodeUnknownPromise(
  WorkspaceEditFileInput
)

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

export type WorkspacePluginActions = {
  assertWritable(): void
  installDependencies(): Promise<WorkspaceCheckRun>
  runChecks(input: {
    message: string
    repairOnFailure: boolean
  }): Promise<WorkspaceCheckRun>
  checkStatus(): Promise<ReadonlyArray<WorkspaceCheckRun>>
  syncProject(): Promise<WorkspaceSyncResult>
  checkpoint(input: { message: string }): Promise<WorkspaceCheckpointResult>
  diff(scope: WorkspaceDiffScope): Promise<WorkspaceDiffResult>
  requestMerge(): Promise<WorkspaceMergeRequest>
  preview(): Promise<WorkspacePreviewResult>
  production(): Promise<WorkspaceProductionStatus>
  browser(input: {
    path?: string
    url?: string
    fullPage: boolean
  }): Promise<WorkspaceBrowserResult>
}

export const workspaceSystemPrompt = [
  "You are coding inside a Cloudflare Durable Object.",
  "Use workspace_list_files, workspace_read_file, workspace_edit_file, workspace_write_file, and workspace_delete_file for source work. The durable workspace filesystem is authoritative. Use workspace_edit_file for exact, unique text replacements; workspace_write_file replaces the entire file.",
  "After changing Bun package.json dependencies or when bun.lock is missing, stale, truncated, or invalid, call workspace_install_dependencies with {}. Cloudflare CI runs Bun, saves the generated lockfile back to the durable Workspace, and starts normal frozen-install Checks automatically. Never generate lockfile entries or integrity hashes yourself, edit the lockfile by hand, or remove frozen validation. Do not run another Check while dependency installation is pending; Sylph delivers the result to this Conversation.",
  "Use workspace_restore_file to discard the changes to one file and restore it from the latest Checkpoint. This can recover a damaged file without rewriting its contents through model output.",
  "Use workspace_checkpoint to commit the Working copy to the Workspace fork without running CI, and workspace_diff to review uncommitted or Checkpoint changes against the Project Repository base.",
  "Use workspace_run_checks after a coherent change; Sylph delivers the Check result to this Conversation when Cloudflare CI finishes, so do not poll workspace_check_status in a loop. Use workspace_check_status for diagnostics, Preview state, and browser evidence.",
  "Use workspace_preview to find or build the Preview of the current Checkpoint, then workspace_browser to open the Preview in a Cloudflare browser, read its rendered content and accessibility tree, and capture screenshot evidence. The browser is limited to the Preview origin.",
  "Use workspace_request_merge to report whether the Workspace fork is ready for Acceptance; a User performs the merge from the Review tab. Use workspace_production to read production Deployment history; an Admin must confirm production deploys from the Deployments tab or Project settings, and you cannot deploy.",
  "Use workspace_sync_project when the Project Repository advances.",
  "Shell, PTY, and local filesystem tools are unavailable in Workerd; Cloudflare CI performs install, typecheck, lint, test, build, preview, browser verification, and deployment.",
].join(" ")

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

  if (evaluation.effect === "ask") {
    evaluation.message = "Allow the assistant to change this Workspace?"
  }
}

export const createWorkspacePlugin = (
  filesystem: WorkspaceFilesystem,
  workspaceGit: WorkspaceGit,
  openAIOAuth: OpenAIOAuthRequestState,
  permissionBridge: WorkspacePermissionBridge,
  skills: WorkspaceSkillRegistry,
  actions: WorkspacePluginActions
) =>
  Plugin.define({
    id: "sylph-workspace",
    vcs: { id: "sylph", markers: [".git"] },
    async setup(context) {
      const skillRegistration = await context.skill.transform((draft) => {
        for (const skill of skills.list()) {
          const policy = runtimeSkillPolicy(skill)
          draft.add({
            id: Skill.ID.make(skill.metadata.name),
            name: Skill.Name.make(skill.metadata.name),
            description: skill.metadata.description,
            slash: policy.slash,
            autoinvoke: policy.autoinvoke,
            location: AbsolutePath.make(`/skills/${skill.metadata.name}.md`),
            content: runtimeSkillContent(skill),
          })
        }
      })
      skills.connect(() => context.skill.reload())
      const toolRegistration = await context.tool.transform((draft) => {
        draft.add({
          name: "skill_read_resource",
          description:
            "Read a supporting file from an installed Skill after the Skill instructions reference it.",
          input: SkillResourceJsonSchema,
          options: workspaceToolOptions,
          async execute(input) {
            const decoded = await decodeSkillResourceInputPromise(input)
            return {
              content: skills.read(decoded.skill, decoded.path),
            }
          },
        })
        draft.add({
          name: "workspace_list_files",
          description:
            "List files in the durable Sylph workspace. Use this instead of shell or local filesystem tools.",
          input: WorkspaceListFilesJsonSchema,
          options: workspaceToolOptions,
          async execute(input) {
            const { directory = "" } = await decodeWorkspaceListFiles(input)
            const rows = filesystem.listWorkingFiles(directory)

            return {
              content: rows.length ? rows.join("\n") : "No files found.",
            }
          },
        })
        draft.add({
          name: "workspace_install_dependencies",
          description:
            "Generate or repair bun.lock from package.json using Bun in Cloudflare CI, verify a frozen install, save the generated lockfile to this Workspace, and automatically run normal Checks. Call with {} after dependency changes or lockfile errors; no manual lockfile edits are needed. Currently supports Bun projects with a text bun.lock or packageManager bun@version.",
          input: WorkspaceCheckStatusToolJsonSchema,
          options: workspaceWriteToolOptions,
          async execute(input, context) {
            await decodeWorkspaceCheckStatusToolInput(input)
            actions.assertWritable()
            await permissionBridge.request({
              sessionID: context.sessionID,
              agent: context.agent,
              messageID: context.messageID,
              toolCallID: context.id,
              action: "workspace_write_file",
              path: "bun.lock",
            })
            actions.assertWritable()
            return {
              content: JSON.stringify(await actions.installDependencies()),
            }
          },
        })
        draft.add({
          name: "workspace_run_checks",
          description:
            "Create a durable Checkpoint and run install, typecheck, lint, test, build, preview, and browser verification in Cloudflare CI.",
          input: WorkspaceRunChecksToolJsonSchema,
          options: workspaceToolOptions,
          async execute(input) {
            const decoded = await decodeWorkspaceRunChecksToolInput(input)
            actions.assertWritable()
            return {
              content: JSON.stringify(
                await actions.runChecks({
                  message:
                    decoded.message ?? "Checkpoint verified Workspace changes",
                  repairOnFailure: decoded.repairOnFailure ?? false,
                })
              ),
            }
          },
        })
        draft.add({
          name: "workspace_check_status",
          description:
            "Read structured Cloudflare CI diagnostics, Preview state, and captured browser evidence for this Workspace.",
          input: WorkspaceCheckStatusToolJsonSchema,
          options: workspaceToolOptions,
          async execute(input) {
            await decodeWorkspaceCheckStatusToolInput(input)
            return { content: JSON.stringify(await actions.checkStatus()) }
          },
        })
        draft.add({
          name: "workspace_sync_project",
          description:
            "Update this Workspace from the latest Project Repository commit and leave useful conflict markers when changes overlap.",
          input: WorkspaceSyncToolJsonSchema,
          options: workspaceToolOptions,
          async execute(input) {
            await decodeWorkspaceSyncToolInput(input)
            actions.assertWritable()
            return { content: JSON.stringify(await actions.syncProject()) }
          },
        })
        draft.add({
          name: "workspace_checkpoint",
          description:
            "Create a durable Checkpoint commit of the Working copy in the Workspace fork without running Cloudflare CI.",
          input: WorkspaceCheckpointToolJsonSchema,
          options: workspaceToolOptions,
          async execute(input) {
            const decoded = await decodeWorkspaceCheckpointToolInput(input)
            actions.assertWritable()
            return {
              content: JSON.stringify(
                await actions.checkpoint({
                  message: decoded.message ?? "Checkpoint Workspace changes",
                })
              ),
            }
          },
        })
        draft.add({
          name: "workspace_diff",
          description:
            "Compare the Workspace with its Project Repository base. Scope working shows uncommitted changes since the Fork head; scope checkpoint shows every Checkpoint change since the Base commit.",
          input: WorkspaceDiffToolJsonSchema,
          options: workspaceToolOptions,
          async execute(input) {
            const decoded = await decodeWorkspaceDiffToolInput(input)
            return {
              content: JSON.stringify(
                await actions.diff(decoded.scope ?? "working")
              ),
            }
          },
        })
        draft.add({
          name: "workspace_request_merge",
          description:
            "Request Acceptance of the current Checkpoint. Reports whether the Workspace fork can merge into the Project Repository and lists every blocker. A User performs the merge from the Review tab.",
          input: WorkspaceMergeToolJsonSchema,
          options: workspaceToolOptions,
          async execute(input) {
            await decodeWorkspaceMergeToolInput(input)
            return { content: JSON.stringify(await actions.requestMerge()) }
          },
        })
        draft.add({
          name: "workspace_preview",
          description:
            "Find the Preview of the current Checkpoint, or start the Check that builds one when none exists.",
          input: WorkspacePreviewToolJsonSchema,
          options: workspaceToolOptions,
          async execute(input) {
            await decodeWorkspacePreviewToolInput(input)
            return { content: JSON.stringify(await actions.preview()) }
          },
        })
        draft.add({
          name: "workspace_production",
          description:
            "Read the Project's Accepted commits and production Deployment history. Production deploys require Admin confirmation in the Deployments tab or Project settings and cannot be started by the agent.",
          input: WorkspaceProductionToolJsonSchema,
          options: workspaceToolOptions,
          async execute(input) {
            await decodeWorkspaceProductionToolInput(input)
            return { content: JSON.stringify(await actions.production()) }
          },
        })
        draft.add({
          name: "workspace_browser",
          description:
            "Open a path on the current Preview in a Cloudflare browser. Returns the rendered page as markdown, its accessibility tree, and stores a screenshot as Check evidence. Limited to the Preview origin.",
          input: WorkspaceBrowserToolJsonSchema,
          options: workspaceToolOptions,
          async execute(input) {
            const decoded = await decodeWorkspaceBrowserToolInput(input)
            const result = await actions.browser({
              path: decoded.path,
              url: decoded.url,
              fullPage: decoded.fullPage ?? false,
            })
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    new WorkspaceBrowserToolOutput({
                      url: result.url,
                      checkId: result.checkId,
                      evidence: result.evidence,
                      accessibility: result.accessibility,
                    })
                  ),
                },
                { type: "text", text: result.markdown },
              ],
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
            actions.assertWritable()
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
          name: "workspace_edit_file",
          description:
            "Replace one exact, unique text match in a durable Workspace file. Include enough oldText context to match exactly once. Other content is preserved; missing or ambiguous matches fail without changing the file.",
          input: WorkspaceEditFileJsonSchema,
          options: workspaceWriteToolOptions,
          async execute(input, context) {
            const decoded = await decodeWorkspaceEditFile(input)
            const path = normalizeWorkspacePath(decoded.path)
            actions.assertWritable()
            await permissionBridge.request({
              sessionID: context.sessionID,
              agent: context.agent,
              messageID: context.messageID,
              toolCallID: context.id,
              action: "workspace_write_file",
              path,
            })
            actions.assertWritable()
            await filesystem.editFile(path, decoded.oldText, decoded.newText)
            return { content: `Edited ${path}` }
          },
        })
        draft.add({
          name: "workspace_restore_file",
          description:
            "Restore one file from the latest Checkpoint, discarding that file's uncommitted changes. Other Workspace files are preserved. The file must exist in the Checkpoint.",
          input: WorkspaceFilePathJsonSchema,
          options: workspaceWriteToolOptions,
          async execute(input, context) {
            const decoded = await decodeWorkspaceFilePath(input)
            const path = normalizeWorkspacePath(decoded.path)
            actions.assertWritable()
            await permissionBridge.request({
              sessionID: context.sessionID,
              agent: context.agent,
              messageID: context.messageID,
              toolCallID: context.id,
              action: "workspace_write_file",
              path,
            })
            const checkpointFile = await workspaceGit.readCheckpointFile(path)
            actions.assertWritable()
            await filesystem.writeFile(path, checkpointFile.content)
            return { content: `Restored ${path} from ${checkpointFile.commit}` }
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
            actions.assertWritable()
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
          session.system.push({ type: "text", text: workspaceSystemPrompt })
        }
      )
      const openAIRequestRegistration = await context.session.hook(
        "model.request",
        (request) => applyOpenAIOAuthRequest(request, openAIOAuth),
        { providerID: "openai" }
      )
      const openRouterResponseRegistration = await context.session.hook(
        "http.response",
        async (event) => {
          event.response = await openRouterErrorResponse(event.response)
        },
        { providerID: "openrouter" }
      )
      return async () => {
        await Promise.all([
          toolRegistration.dispose(),
          skillRegistration.dispose(),
          agentRegistration.dispose(),
          permissionRegistration.dispose(),
          vcsRegistration.dispose(),
          sessionRegistration.dispose(),
          openAIRequestRegistration.dispose(),
          openRouterResponseRegistration.dispose(),
        ])
      }
    },
  })
