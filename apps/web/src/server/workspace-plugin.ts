import { codexContainerResponse } from "./codex-container-response"
import {
  assertWorkspaceModelRequestSize,
  boundedWorkspaceModelLimits,
} from "./workspace-model-limits"
import { openRouterErrorResponse } from "./openrouter-response"
import { workspaceModelCacheBody } from "./workspace-model-cache"
import {
  SkillResourceJsonSchema,
  type WorkspaceBrowserResult,
  WorkspaceBrowserToolOutput,
  WorkspaceBrowserToolJsonSchema,
  type WorkspaceCheckpointResult,
  WorkspaceCheckpointToolJsonSchema,
  type WorkspaceCheckRun,
  type WorkspacePreviewResult,
  WorkspacePreviewToolJsonSchema,
  WorkspaceRunChecksToolJsonSchema,
  WorkspaceSyncToolJsonSchema,
  type WorkspaceSyncResult,
  SkillResourceInput,
  WorkspaceBrowserToolInput,
  WorkspaceCheckpointToolInput,
  WorkspacePreviewToolInput,
  WorkspaceRunChecksToolInput,
  WorkspaceSyncToolInput,
} from "@workspace/domain"
import { Plugin } from "@opencode-ai/plugin"
import { Skill } from "@opencode-ai/schema/skill"
import { AbsolutePath } from "@opencode-ai/schema/schema"

import {
  applyOpenAIOAuthRequest,
  type OpenAIOAuthRequestState,
} from "./opencode-oauth-request"
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
const decodeWorkspaceCheckpointToolInput = Schema.decodeUnknownPromise(
  WorkspaceCheckpointToolInput
)

const decodeWorkspacePreviewToolInput = Schema.decodeUnknownPromise(
  WorkspacePreviewToolInput
)
const decodeWorkspaceRunChecksToolInput = Schema.decodeUnknownPromise(
  WorkspaceRunChecksToolInput
)
const decodeWorkspaceSyncToolInput = Schema.decodeUnknownPromise(
  WorkspaceSyncToolInput
)

export const selectWorkspaceVcs = (draft: {
  readonly default?: { set(selection: string): void }
}) => draft.default?.set("sylph")

export const workspaceToolOptions = {
  codemode: false,
} satisfies { readonly codemode: false }

export type WorkspacePluginActions = {
  codexRequest: (request: Request) => Promise<Response>
  authorizeModelRequest?(request: Request): Promise<void>
  assertWritable(): void
  runChecks(input: {
    message: string
    repairOnFailure: boolean
  }): Promise<WorkspaceCheckRun>
  syncProject(): Promise<WorkspaceSyncResult>
  checkpoint(input: { message: string }): Promise<WorkspaceCheckpointResult>
  preview(): Promise<WorkspacePreviewResult>
  browser(input: {
    path?: string
    url?: string
    fullPage: boolean
  }): Promise<WorkspaceBrowserResult>
}

export const workspaceSystemPrompt = [
  "Use native read, write, edit, patch, glob, grep, and shell tools to work in /workspace.",
  "Shell commands run in a Linux sandbox with Git, Node, and Bun. Source changes are saved to the durable Workspace when the command finishes. Dependencies and build output stay in the sandbox. File tools access the same durable source. Do not run file mutations concurrently with shell commands.",
  "Use bun install after dependency changes to generate bun.lock. Never invent lockfile entries. Run commands to inspect diffs, restore files, and test your work.",
  "Use workspace_checkpoint to save a durable commit. Shell Git commits are sandbox-local; Sylph owns the durable Workspace fork and its Checkpoints.",
  "Use workspace_run_checks after a coherent change to create a Checkpoint and run recorded Checks, including a Preview build. Then end your response. Do not poll. Results appear automatically and are system context for the next user request. Claim success only after a terminal result exists.",
  "Use workspace_preview to find or build the current Checkpoint Preview and workspace_browser to inspect it and save screenshot evidence.",
  "Use workspace_sync_project to update from the Project Repository. Users accept changes from Review and confirm production deployments through the product.",
].join(" ")

export const workspaceMutationPermissions = [
  {
    action: "edit",
    resource: "*",
    effect: "allow",
  },
  {
    action: "shell",
    resource: "*",
    effect: "allow",
  },
] satisfies ReadonlyArray<{
  readonly action: string
  readonly resource: string
  readonly effect: "allow"
}>

export const createWorkspacePlugin = (
  workspaceGit: WorkspaceGit,
  openAIOAuth: OpenAIOAuthRequestState,
  skills: WorkspaceSkillRegistry,
  actions: WorkspacePluginActions
) =>
  Plugin.define({
    id: "sylph-workspace",
    vcs: { id: "sylph", markers: [".git"] },
    async setup(context) {
      const modelLimitRegistration = await context.catalog.transform(
        (draft) => {
          for (const provider of draft.provider.list()) {
            for (const model of provider.models.values()) {
              draft.model.update(
                model.providerID.toString(),
                model.modelID.toString(),
                (current) => {
                  current.limit = boundedWorkspaceModelLimits(current.limit)
                  current.body = workspaceModelCacheBody(
                    current.providerID.toString(),
                    current.modelID.toString(),
                    current.body
                  )
                }
              )
            }
          }
        }
      )
      const requestLimitRegistration = await context.session.hook(
        "http.request",
        async (event) => {
          await assertWorkspaceModelRequestSize(event.request, event.agent)
          await actions.authorizeModelRequest?.(event.request)
        }
      )
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
          name: "workspace_run_checks",
          description:
            "Run install, typecheck, lint, test, build, preview, and browser verification in Cloudflare CI. Save changed files in a durable Checkpoint first, or reuse the current Checkpoint when the working copy is clean.",
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
      const openAIResponseRegistration = await context.session.hook(
        "http.response",
        async (event) => {
          event.response = await codexContainerResponse(
            event.request,
            event.response,
            actions.codexRequest
          )
        },
        { providerID: "openai" }
      )
      return async () => {
        await Promise.all([
          modelLimitRegistration.dispose(),
          requestLimitRegistration.dispose(),
          toolRegistration.dispose(),
          skillRegistration.dispose(),
          agentRegistration.dispose(),
          vcsRegistration.dispose(),
          sessionRegistration.dispose(),
          openAIRequestRegistration.dispose(),
          openRouterResponseRegistration.dispose(),
          openAIResponseRegistration.dispose(),
        ])
      }
    },
  })
