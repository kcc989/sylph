import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import git from "isomorphic-git"
import http from "isomorphic-git/http/web"

import { MemoryFilesystem } from "./memory-filesystem"
import { mergeWorkspaceHeads } from "./workspace-merge-heads"

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
      await step.sleep("retain-workspace-fork", "7 days")
      await step.do(
        "delete-workspace-fork",
        { retries: { limit: 5, delay: "1 minute", backoff: "exponential" } },
        async () => {
          await this.env.REPOS.delete(input.workspaceRepositoryName)
        }
      )
      return { status: "merged", acceptedCommit }
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
}
