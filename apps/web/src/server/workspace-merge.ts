import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import git from "isomorphic-git"
import http from "isomorphic-git/http/web"
import { Effect } from "effect"

import { MemoryFilesystem } from "./memory-filesystem"
import { mergeWorkspaceHeads } from "./workspace-merge-heads"
import {
  GitHubRepositoryLive,
  GitHubRepositoryService,
} from "./github-repository-service"

export interface WorkspaceMergeInput {
  operationId: string
  workspaceId: string
  projectRepositoryName: string
  projectRepositoryRemote: string
  workspaceRepositoryName: string
  workspaceRepositoryRemote: string
  defaultRef: string
  baseCommit: string
  forkHead: string
  projectId: string
  actorUserId: string
}

const directory = "/workspace"
const tokenSecret = (token: string) => token.split("?expires=")[0]
const authentication = (token: string) => () => ({
  username: "x",
  password: tokenSecret(token),
})

interface WorkspaceMergeBindings extends Cloudflare.Env {
  DB: D1Database
  REPOS: Artifacts
}

interface DeliveryContext {
  importOriginUrl: string | null
  importOriginBranch: string | null
  deliveryMode: string
  accessToken: string | null
}

export class WorkspaceMerge extends WorkflowEntrypoint<
  WorkspaceMergeBindings,
  WorkspaceMergeInput
> {
  async run(
    event: Readonly<WorkflowEvent<WorkspaceMergeInput>>,
    step: WorkflowStep
  ) {
    const input = event.payload
    try {
      const acceptedCommit = await step.do(
        "merge-workspace-fork",
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
        async () => this.#merge(input)
      )
      await step.do("record-accepted-commit", async () => {
        await this.env.DB.prepare(
          "UPDATE workspace SET accepted_commit = ?, status = 'archived', merge_status = 'merged', sync_status = 'ready', archived_at = unixepoch(), error_summary = NULL, updated_at = unixepoch() WHERE id = ?"
        )
          .bind(acceptedCommit, input.workspaceId)
          .run()
        await this.env.DB.prepare(
          "UPDATE repository_operation SET status = 'complete', commit = ?, error_summary = NULL, updated_at = unixepoch() WHERE id = ?"
        )
          .bind(acceptedCommit, input.operationId)
          .run()
      })
      let delivery: { url: string } | null = null
      let deliveryError: string | null = null
      try {
        delivery = await step.do(
          "deliver-to-github",
          {
            retries: {
              limit: 3,
              delay: "10 seconds",
              backoff: "exponential",
            },
          },
          async () => this.#deliver(input, acceptedCommit)
        )
      } catch (cause) {
        deliveryError =
          cause instanceof Error ? cause.message : "GitHub delivery failed"
        await step.do("record-github-delivery-failure", async () => {
          await this.env.DB.prepare(
            "UPDATE project SET upstream_status = 'delivery_conflict', delivery_url = NULL, updated_at = unixepoch() WHERE id = ?"
          )
            .bind(input.projectId)
            .run()
          await this.env.DB.prepare(
            "UPDATE repository_operation SET error_summary = ?, updated_at = unixepoch() WHERE id = ?"
          )
            .bind(deliveryError, input.operationId)
            .run()
        })
      }
      if (delivery) {
        await step.do("record-github-delivery", async () => {
          await this.env.DB.prepare(
            "UPDATE project SET delivered_commit = ?, delivery_url = ?, upstream_status = 'up_to_date', upstream_head = ?, upstream_synced_at = unixepoch(), updated_at = unixepoch() WHERE id = ?"
          )
            .bind(acceptedCommit, delivery.url, acceptedCommit, input.projectId)
            .run()
        })
      }
      await step.sleep("retain-workspace-fork", "7 days")
      await step.do(
        "delete-workspace-fork",
        { retries: { limit: 5, delay: "1 minute", backoff: "exponential" } },
        async () => {
          await this.env.REPOS.delete(input.workspaceRepositoryName)
        }
      )
      return { status: "merged", acceptedCommit, delivery, deliveryError }
    } catch (cause) {
      const conflict =
        cause instanceof Error &&
        (cause.name.includes("Merge") || cause.message.includes("conflict"))
      const status = conflict ? "merge_conflict" : "error"
      const summary = conflict
        ? "The Project Repository and Workspace fork contain conflicting changes"
        : cause instanceof Error
          ? cause.message
          : "Workspace merge failed"
      await step.do("record-merge-failure", async () => {
        await this.env.DB.prepare(
          "UPDATE workspace SET status = 'ready', merge_status = ?, error_summary = ?, updated_at = unixepoch() WHERE id = ?"
        )
          .bind(status, summary, input.workspaceId)
          .run()
        await this.env.DB.prepare(
          "UPDATE repository_operation SET status = 'error', error_summary = ?, updated_at = unixepoch() WHERE id = ?"
        )
          .bind(summary, input.operationId)
          .run()
      })
      return { status, error: summary }
    }
  }

  async #merge(input: WorkspaceMergeInput) {
    const projectRepository = await this.env.REPOS.get(
      input.projectRepositoryName
    )
    const workspaceRepository = await this.env.REPOS.get(
      input.workspaceRepositoryName
    )
    const [projectToken, workspaceToken] = await Promise.all([
      projectRepository.createToken("write", 300),
      workspaceRepository.createToken("read", 300),
    ])
    const filesystem = new MemoryFilesystem()
    await git.clone({
      fs: filesystem,
      http,
      dir: directory,
      url: input.projectRepositoryRemote,
      ref: input.defaultRef,
      singleBranch: true,
      noTags: true,
      onAuth: authentication(projectToken.plaintext),
    })
    const projectHead = await git.resolveRef({
      fs: filesystem,
      dir: directory,
      ref: "HEAD",
    })
    await git.fetch({
      fs: filesystem,
      http,
      dir: directory,
      url: input.workspaceRepositoryRemote,
      remote: "workspace",
      ref: input.defaultRef,
      singleBranch: true,
      tags: false,
      onAuth: authentication(workspaceToken.plaintext),
    })
    const fetchedForkHead = await git.resolveRef({
      fs: filesystem,
      dir: directory,
      ref: `refs/remotes/workspace/${input.defaultRef}`,
    })
    if (fetchedForkHead !== input.forkHead) {
      throw new Error("Workspace fork changed after review")
    }
    const acceptedCommit = await mergeWorkspaceHeads({
      filesystem,
      workspaceId: input.workspaceId,
      defaultRef: input.defaultRef,
      baseCommit: input.baseCommit,
      projectHead,
      forkHead: input.forkHead,
    })
    await git.push({
      fs: filesystem,
      http,
      dir: directory,
      url: input.projectRepositoryRemote,
      ref: input.defaultRef,
      remoteRef: input.defaultRef,
      force: false,
      onAuth: authentication(projectToken.plaintext),
    })
    return acceptedCommit
  }

  async #deliver(input: WorkspaceMergeInput, acceptedCommit: string) {
    const context = await this.env.DB.prepare(
      "SELECT project.import_origin_url AS importOriginUrl, project.import_origin_branch AS importOriginBranch, project.delivery_mode AS deliveryMode, account.access_token AS accessToken FROM project LEFT JOIN account ON account.user_id = ? AND account.provider_id = 'github' WHERE project.id = ?"
    )
      .bind(input.actorUserId, input.projectId)
      .first<DeliveryContext>()
    if (!context?.importOriginUrl) return null
    if (!context.accessToken) {
      throw new Error("Reconnect GitHub before delivering accepted work")
    }
    const accessToken = context.accessToken

    const projectRepository = await this.env.REPOS.get(
      input.projectRepositoryName
    )
    const projectToken = await projectRepository.createToken("read", 300)
    const filesystem = new MemoryFilesystem()
    await git.clone({
      fs: filesystem,
      http,
      dir: directory,
      url: input.projectRepositoryRemote,
      ref: input.defaultRef,
      singleBranch: true,
      noTags: false,
      onAuth: authentication(projectToken.plaintext),
    })
    const localHead = await git.resolveRef({
      fs: filesystem,
      dir: directory,
      ref: "HEAD",
    })
    if (localHead !== acceptedCommit) {
      throw new Error("Accepted commit changed before GitHub delivery")
    }
    const upstreamRef = context.importOriginBranch ?? input.defaultRef
    if (context.deliveryMode === "push") {
      await git.push({
        fs: filesystem,
        http,
        dir: directory,
        url: `${context.importOriginUrl}.git`,
        ref: input.defaultRef,
        remoteRef: upstreamRef,
        force: false,
        onAuth: authentication(accessToken),
      })
      return { url: `${context.importOriginUrl}/commit/${acceptedCommit}` }
    }

    const branch = `sylph/workspace-${input.workspaceId.slice(0, 8)}`
    await git.push({
      fs: filesystem,
      http,
      dir: directory,
      url: `${context.importOriginUrl}.git`,
      ref: input.defaultRef,
      remoteRef: branch,
      force: false,
      onAuth: authentication(accessToken),
    })
    const location = new URL(context.importOriginUrl)
    const [owner, name] = location.pathname.split("/").filter(Boolean)
    if (!owner || !name) throw new Error("GitHub Repository URL is invalid")
    const url = await Effect.runPromise(
      Effect.gen(function* () {
        const github = yield* GitHubRepositoryService
        return yield* github.ensurePullRequest({
          owner,
          name,
          accessToken,
          head: branch,
          base: upstreamRef,
          title: `Accept ${input.workspaceId.slice(0, 8)}`,
          body: "Accepted from a Sylph Workspace.",
        })
      }).pipe(Effect.provide(GitHubRepositoryLive))
    )
    return { url }
  }
}
