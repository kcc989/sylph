import {
  GitCommitId,
  WorkspaceCheckpoint,
  WorkspaceCheckpointResult,
  WorkspaceFileChange,
  WorkspaceVersionControl,
  WorkspaceRebaseResult,
} from "@workspace/domain"
import { createTwoFilesPatch } from "diff"
import git from "isomorphic-git"
import http from "isomorphic-git/http/web"
import { Option, Schema } from "effect"

import type {
  WorkspaceGitFilesystem,
  WorkspaceStorage,
} from "./workspace-filesystem"
import { normalizeWorkspacePath } from "./workspace-filesystem"
import { artifactAuth } from "./repository-store"

export interface WorkspaceRepositoryHandle {
  readonly defaultBranch: string
  createToken(
    scope: "read" | "write",
    ttlSeconds: number
  ): Promise<{ readonly plaintext: string }>
}

export interface WorkspaceRepositoryNamespace {
  get(name: string): Promise<WorkspaceRepositoryHandle>
}

const directory = "/workspace"
const author = { name: "Sylph", email: "checkpoints@sylph.dev" }

interface WorkspaceGitState {
  [key: string]: SqlStorageValue
  repositoryName: string
  repositoryRemote: string
  projectRepositoryName: string
  projectRepositoryRemote: string
  defaultRef: string
  baseCommit: string
  forkHead: string
  projectHead: string
  syncStatus: string
  mergeStatus: string
}

interface CheckpointRow {
  [key: string]: SqlStorageValue
  id: string
  commitId: string
  message: string
  createdAt: number
  status: string
}

const textContent = (content: Uint8Array | void) => {
  if (!content) return ""
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content)
  } catch {
    return null
  }
}

const lineCounts = (patch: string) => {
  let additions = 0
  let deletions = 0
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1
  }
  return { additions, deletions }
}

export const isRepositoryMetadata = (file: string) =>
  file === ".git" || file.startsWith(".git/")

export const artifactGitProtocolVersion = (forPush: boolean) =>
  forPush ? (1 as const) : (2 as const)

export const workspaceRebaseConflictState = (projectHead: string) => ({
  projectHead,
  syncStatus: "diverged" as const,
  mergeStatus: "unreviewed" as const,
})

export const workspaceProjectRemote = (url: string) => ({
  remote: "project",
  url,
  force: true,
})

export const workspaceHydrationRefs = (
  workspaceRef: string,
  projectRef: string
) => ({
  createRef: workspaceRef === projectRef ? null : workspaceRef,
  sourceRef: projectRef,
})

export class WorkspaceGit {
  readonly #storage: WorkspaceStorage
  readonly #repositories: WorkspaceRepositoryNamespace
  readonly #filesystem: WorkspaceGitFilesystem

  constructor(
    storage: WorkspaceStorage,
    repositories: WorkspaceRepositoryNamespace,
    filesystem: WorkspaceGitFilesystem
  ) {
    this.#storage = storage
    this.#repositories = repositories
    this.#filesystem = filesystem
  }

  initialize() {
    this.#storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS app_workspace_vcs (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), repository_name TEXT NOT NULL, repository_remote TEXT NOT NULL, project_repository_name TEXT NOT NULL, project_repository_remote TEXT NOT NULL, default_ref TEXT NOT NULL, base_commit TEXT NOT NULL, fork_head TEXT NOT NULL, project_head TEXT NOT NULL, sync_status TEXT NOT NULL, merge_status TEXT NOT NULL)"
    )
    this.#storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS app_workspace_checkpoint (id TEXT PRIMARY KEY NOT NULL, commit_id TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL)"
    )
    this.#storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS app_workspace_outbox (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, completed_at INTEGER)"
    )
  }

  async readCheckpointFile(pathValue: string) {
    const path = normalizeWorkspacePath(pathValue)
    if (!path || isRepositoryMetadata(path)) {
      throw new Error("Choose a source file inside the Workspace")
    }
    const commit = await git.resolveRef({
      fs: this.#filesystem,
      dir: directory,
      ref: "HEAD",
    })
    const { blob } = await git.readBlob({
      fs: this.#filesystem,
      dir: directory,
      oid: commit,
      filepath: path,
    })
    return { commit, content: blob }
  }

  async hydrate(input: {
    repositoryName: string
    repositoryRemote: string
    projectRepositoryName: string
    projectRepositoryRemote: string
    defaultRef: string
    sourceRef?: string
    baseCommit: string
  }) {
    const existing = this.#state()
    if (
      existing?.repositoryName === input.repositoryName &&
      existing.baseCommit === input.baseCommit
    ) {
      const head = await git
        .resolveRef({ fs: this.#filesystem, dir: directory, ref: "HEAD" })
        .catch(() => null)
      if (head === existing.forkHead) return GitCommitId.make(head)
    }

    this.#filesystem.clear()
    const repository = await this.#repositories.get(input.repositoryName)
    const token = await repository.createToken("write", 300)
    const sourceRef =
      input.sourceRef ??
      ((await this.#optionalRemoteHead(
        input.repositoryRemote,
        input.defaultRef,
        token.plaintext,
        false
      ))
        ? input.defaultRef
        : repository.defaultBranch)
    await git.clone({
      fs: this.#filesystem,
      http,
      dir: directory,
      url: input.repositoryRemote,
      ref: sourceRef,
      singleBranch: true,
      noTags: true,
      onAuth: artifactAuth(token.plaintext),
    })
    const refs = workspaceHydrationRefs(input.defaultRef, sourceRef)
    if (refs.createRef) {
      await git.branch({
        fs: this.#filesystem,
        dir: directory,
        ref: refs.createRef,
        checkout: true,
      })
    }
    const forkHead = await git.resolveRef({
      fs: this.#filesystem,
      dir: directory,
      ref: "HEAD",
    })
    if (forkHead !== input.baseCommit) {
      throw new Error("Workspace fork does not match its base commit")
    }
    this.#storage.sql.exec(
      "INSERT INTO app_workspace_vcs (singleton, repository_name, repository_remote, project_repository_name, project_repository_remote, default_ref, base_commit, fork_head, project_head, sync_status, merge_status) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 'unreviewed') ON CONFLICT(singleton) DO UPDATE SET repository_name = excluded.repository_name, repository_remote = excluded.repository_remote, project_repository_name = excluded.project_repository_name, project_repository_remote = excluded.project_repository_remote, default_ref = excluded.default_ref, base_commit = excluded.base_commit, fork_head = excluded.fork_head, project_head = excluded.project_head, sync_status = 'ready', merge_status = 'unreviewed'",
      input.repositoryName,
      input.repositoryRemote,
      input.projectRepositoryName,
      input.projectRepositoryRemote,
      input.defaultRef,
      input.baseCommit,
      forkHead,
      input.baseCommit
    )
    return GitCommitId.make(forkHead)
  }

  async versionControl(refreshProjectHead = false) {
    const state = this.#requiredState()
    const latestProjectHead = refreshProjectHead
      ? await this.#readProjectHead(state)
      : state.projectHead
    if (latestProjectHead !== state.projectHead) {
      this.#storage.sql.exec(
        "UPDATE app_workspace_vcs SET project_head = ? WHERE singleton = 1",
        latestProjectHead
      )
    }
    const working = await this.#changes(state.forkHead, "working")
    const branch = await this.#changes(state.baseCommit, state.forkHead)
    return new WorkspaceVersionControl({
      defaultRef: state.defaultRef,
      currentRef: state.defaultRef,
      baseCommit: GitCommitId.make(state.baseCommit),
      forkHead: GitCommitId.make(state.forkHead),
      projectHead: GitCommitId.make(latestProjectHead),
      projectChanged: latestProjectHead !== state.baseCommit,
      syncStatus: state.syncStatus === "diverged" ? "diverged" : "ready",
      mergeStatus: state.mergeStatus === "ready" ? "ready" : "unreviewed",
      working,
      branch,
    })
  }

  async rebase() {
    const state = this.#requiredState()
    const working = await this.#changes(state.forkHead, "working")
    if (working.length) {
      throw new Error(
        "Checkpoint or discard Working copy changes before rebasing"
      )
    }
    const repository = await this.#repositories.get(state.repositoryName)
    const token = await repository.createToken("write", 300)
    const remoteHead = await this.#optionalRemoteHead(
      state.repositoryRemote,
      state.defaultRef,
      token.plaintext,
      true
    )
    if (remoteHead && remoteHead !== state.forkHead) {
      this.#markDiverged()
      throw new Error("Workspace fork changed outside Sylph")
    }
    const projectRepository = await this.#repositories.get(
      state.projectRepositoryName
    )
    const projectToken = await projectRepository.createToken("read", 300)
    const projectRef = projectRepository.defaultBranch
    await git.addRemote({
      fs: this.#filesystem,
      dir: directory,
      ...workspaceProjectRemote(state.projectRepositoryRemote),
    })
    await git.fetch({
      fs: this.#filesystem,
      http,
      dir: directory,
      remote: "project",
      ref: projectRef,
      singleBranch: true,
      tags: false,
      onAuth: artifactAuth(projectToken.plaintext),
    })
    const projectHead = await git.resolveRef({
      fs: this.#filesystem,
      dir: directory,
      ref: `refs/remotes/project/${projectRef}`,
    })
    if (projectHead === state.baseCommit) {
      return new WorkspaceRebaseResult({
        baseCommit: GitCommitId.make(state.baseCommit),
        forkHead: GitCommitId.make(state.forkHead),
        projectHead: GitCommitId.make(projectHead),
      })
    }
    const accepted = await git.isDescendent({
      fs: this.#filesystem,
      dir: directory,
      oid: projectHead,
      ancestor: state.forkHead,
    })
    let forkHead = projectHead
    if (!accepted) {
      const merge = await git
        .merge({
          fs: this.#filesystem,
          dir: directory,
          ours: projectHead,
          theirs: state.forkHead,
          fastForward: false,
          abortOnConflict: false,
          message: "Prepare Workspace rebase",
          author,
        })
        .catch((cause) => {
          if (!(cause instanceof git.Errors.MergeConflictError)) throw cause
          const conflict = workspaceRebaseConflictState(projectHead)
          this.#storage.sql.exec(
            "UPDATE app_workspace_vcs SET project_head = ?, sync_status = ?, merge_status = ? WHERE singleton = 1",
            conflict.projectHead,
            conflict.syncStatus,
            conflict.mergeStatus
          )
          throw cause
        })
      if (!merge.oid) throw new Error("Rebase did not produce a commit")
      const merged = await git.readCommit({
        fs: this.#filesystem,
        dir: directory,
        oid: merge.oid,
      })
      forkHead = await git.commit({
        fs: this.#filesystem,
        dir: directory,
        ref: state.defaultRef,
        message: "Rebase Workspace changes",
        author,
        parent: [projectHead],
        tree: merged.commit.tree,
      })
    } else {
      await git.writeRef({
        fs: this.#filesystem,
        dir: directory,
        ref: `refs/heads/${state.defaultRef}`,
        value: projectHead,
        force: true,
      })
    }
    await git.checkout({
      fs: this.#filesystem,
      dir: directory,
      ref: state.defaultRef,
      force: true,
    })
    await git.push({
      fs: this.#filesystem,
      http,
      dir: directory,
      url: state.repositoryRemote,
      ref: state.defaultRef,
      remoteRef: state.defaultRef,
      force: true,
      onAuth: artifactAuth(token.plaintext),
    })
    this.#storage.sql.exec(
      "UPDATE app_workspace_vcs SET base_commit = ?, fork_head = ?, project_head = ?, sync_status = 'ready', merge_status = 'ready' WHERE singleton = 1",
      projectHead,
      forkHead,
      projectHead
    )
    return new WorkspaceRebaseResult({
      baseCommit: GitCommitId.make(projectHead),
      forkHead: GitCommitId.make(forkHead),
      projectHead: GitCommitId.make(projectHead),
    })
  }

  async checkpoint(input: { idempotencyKey: string; message: string }) {
    const existing = this.#checkpoint(input.idempotencyKey)
    if (existing?.status === "complete") {
      return new WorkspaceCheckpointResult({
        checkpoint: this.#checkpointValue(existing),
        replayed: true,
      })
    }

    const state = this.#requiredState()
    const repository = await this.#repositories.get(state.repositoryName)
    const token = await repository.createToken("write", 300)
    const remoteHead = await this.#optionalRemoteHead(
      state.repositoryRemote,
      state.defaultRef,
      token.plaintext,
      true
    )

    if (existing) {
      if (remoteHead === existing.commitId) {
        this.#completeCheckpoint(existing.id, existing.commitId)
        return new WorkspaceCheckpointResult({
          checkpoint: this.#checkpointValue({
            ...existing,
            status: "complete",
          }),
          replayed: true,
        })
      }
      if (remoteHead && remoteHead !== state.forkHead) {
        this.#markDiverged()
        throw new Error("Workspace fork changed outside Sylph")
      }
      await this.#push(state, token.plaintext)
      this.#completeCheckpoint(existing.id, existing.commitId)
      return new WorkspaceCheckpointResult({
        checkpoint: this.#checkpointValue({ ...existing, status: "complete" }),
        replayed: true,
      })
    }

    if (remoteHead && remoteHead !== state.forkHead) {
      this.#markDiverged()
      throw new Error("Workspace fork changed outside Sylph")
    }
    const matrix = await git.statusMatrix({
      fs: this.#filesystem,
      dir: directory,
      ref: state.forkHead,
    })
    const changed = matrix.filter(
      ([filepath, head, worktree]) =>
        !isRepositoryMetadata(filepath) && head !== worktree
    )
    if (!changed.length) throw new Error("The Working copy has no changes")
    for (const [filepath, , worktree] of changed) {
      if (worktree === 0) {
        await git.remove({ fs: this.#filesystem, dir: directory, filepath })
      } else {
        await git.add({ fs: this.#filesystem, dir: directory, filepath })
      }
    }
    const parents =
      state.syncStatus === "diverged" && state.projectHead !== state.baseCommit
        ? [state.forkHead, state.projectHead]
        : undefined
    const commit = await git.commit({
      fs: this.#filesystem,
      dir: directory,
      message: input.message,
      author,
      parent: parents,
    })
    const createdAt = Date.now()
    this.#storage.sql.exec(
      "INSERT INTO app_workspace_checkpoint (id, commit_id, message, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
      input.idempotencyKey,
      commit,
      input.message,
      createdAt
    )
    await this.#push(state, token.plaintext)
    this.#completeCheckpoint(input.idempotencyKey, commit)
    return new WorkspaceCheckpointResult({
      checkpoint: new WorkspaceCheckpoint({
        id: input.idempotencyKey,
        commit: GitCommitId.make(commit),
        message: input.message,
        createdAt,
      }),
      replayed: false,
    })
  }

  hasCheckpoint(id: string) {
    return Boolean(this.#checkpoint(id))
  }

  checkpoints() {
    return this.#storage.sql
      .exec<CheckpointRow>(
        "SELECT id, commit_id AS commitId, message, created_at AS createdAt, status FROM app_workspace_checkpoint WHERE status = 'complete' ORDER BY created_at DESC"
      )
      .toArray()
      .map((row) => this.#checkpointValue(row))
  }

  async syncProject() {
    const state = this.#requiredState()
    const working = await this.#changes(state.forkHead, "working")
    if (working.length) {
      throw new Error(
        "Create a Checkpoint before updating from the Project Repository"
      )
    }

    const projectRepository = await this.#repositories.get(
      state.projectRepositoryName
    )
    const projectToken = await projectRepository.createToken("read", 300)
    const projectRef = projectRepository.defaultBranch
    await git.addRemote({
      fs: this.#filesystem,
      dir: directory,
      ...workspaceProjectRemote(state.projectRepositoryRemote),
    })
    await git.fetch({
      fs: this.#filesystem,
      http,
      dir: directory,
      url: state.projectRepositoryRemote,
      remote: "project",
      ref: projectRef,
      singleBranch: true,
      tags: false,
      onAuth: artifactAuth(projectToken.plaintext),
    })
    const projectCommit = await git.resolveRef({
      fs: this.#filesystem,
      dir: directory,
      ref: `refs/remotes/project/${projectRef}`,
    })
    if (projectCommit === state.baseCommit) {
      return {
        status: "current" as const,
        projectCommit: GitCommitId.make(projectCommit),
        conflictedFiles: [],
      }
    }

    try {
      const result = await git.merge({
        fs: this.#filesystem,
        dir: directory,
        ours: state.defaultRef,
        theirs: `refs/remotes/project/${projectRef}`,
        abortOnConflict: false,
        message: "Update Workspace from Project Repository",
        author,
      })
      const forkHead = result.oid ?? state.forkHead
      const repository = await this.#repositories.get(state.repositoryName)
      const token = await repository.createToken("write", 300)
      await this.#push({ ...state, forkHead }, token.plaintext)
      const checkpointId = `sync-${projectCommit}`
      this.#storage.sql.exec(
        "INSERT OR IGNORE INTO app_workspace_checkpoint (id, commit_id, message, status, created_at) VALUES (?, ?, 'Update from Project Repository', 'complete', ?)",
        checkpointId,
        forkHead,
        Date.now()
      )
      this.#storage.sql.exec(
        "UPDATE app_workspace_vcs SET base_commit = ?, fork_head = ?, project_head = ?, sync_status = 'ready', merge_status = 'ready' WHERE singleton = 1",
        projectCommit,
        forkHead,
        projectCommit
      )
      return {
        status: "updated" as const,
        projectCommit: GitCommitId.make(projectCommit),
        conflictedFiles: [],
      }
    } catch (cause) {
      if (!(cause instanceof git.Errors.MergeConflictError)) throw cause
      const conflictedFiles = Option.getOrElse(
        Schema.decodeUnknownOption(Schema.Array(Schema.String))(cause.data),
        () => []
      )
      this.#storage.sql.exec(
        "UPDATE app_workspace_vcs SET project_head = ?, sync_status = 'diverged', merge_status = 'unreviewed' WHERE singleton = 1",
        projectCommit
      )
      return {
        status: "conflicted" as const,
        projectCommit: GitCommitId.make(projectCommit),
        conflictedFiles,
      }
    }
  }

  async #changes(from: string, to: "working" | string) {
    const changes: WorkspaceFileChange[] = []
    const trees =
      to === "working"
        ? [git.TREE({ ref: from }), git.WORKDIR()]
        : [git.TREE({ ref: from }), git.TREE({ ref: to })]
    await git.walk({
      fs: this.#filesystem,
      dir: directory,
      trees,
      map: async (file, entries) => {
        if (file === "." || isRepositoryMetadata(file)) return
        const [before, after] = entries
        const beforeType = before ? await before.type() : null
        const afterType = after ? await after.type() : null
        if (beforeType === "tree" || afterType === "tree") return
        const beforeContent = textContent(await before?.content())
        const afterContent = textContent(await after?.content())
        if (beforeContent === afterContent) return
        const status = before ? (after ? "modified" : "deleted") : "added"
        const patch =
          beforeContent === null || afterContent === null
            ? `diff --git a/${file} b/${file}\nBinary files differ\n`
            : `diff --git a/${file} b/${file}\n${createTwoFilesPatch(
                `a/${file}`,
                `b/${file}`,
                beforeContent,
                afterContent,
                "",
                "",
                { context: 3 }
              )}`
        const counts = lineCounts(patch)
        changes.push(
          new WorkspaceFileChange({ file, status, patch, ...counts })
        )
      },
    })
    return changes.sort((left, right) => left.file.localeCompare(right.file))
  }

  async #remoteHead(
    remote: string,
    ref: string,
    plaintext: string,
    forPush: boolean
  ) {
    const head = await this.#optionalRemoteHead(remote, ref, plaintext, forPush)
    if (!head) throw new Error("Workspace fork default ref is missing")
    return head
  }

  async #readProjectHead(state: WorkspaceGitState) {
    const repository = await this.#repositories.get(state.projectRepositoryName)
    const token = await repository.createToken("read", 300)
    return this.#remoteHead(
      state.projectRepositoryRemote,
      repository.defaultBranch,
      token.plaintext,
      false
    )
  }

  async #optionalRemoteHead(
    remote: string,
    ref: string,
    plaintext: string,
    forPush: boolean
  ) {
    const refs = await git.listServerRefs({
      http,
      url: remote,
      prefix: `refs/heads/${ref}`,
      forPush,
      protocolVersion: artifactGitProtocolVersion(forPush),
      onAuth: artifactAuth(plaintext),
    })
    return (
      refs.find((candidate) => candidate.ref === `refs/heads/${ref}`)?.oid ??
      null
    )
  }

  async #push(state: WorkspaceGitState, plaintext: string) {
    await git.push({
      fs: this.#filesystem,
      http,
      dir: directory,
      url: state.repositoryRemote,
      ref: state.defaultRef,
      remoteRef: state.defaultRef,
      force: false,
      onAuth: artifactAuth(plaintext),
    })
  }

  hydrated() {
    return this.#state() !== undefined
  }

  #state() {
    return this.#storage.sql
      .exec<WorkspaceGitState>(
        "SELECT repository_name AS repositoryName, repository_remote AS repositoryRemote, project_repository_name AS projectRepositoryName, project_repository_remote AS projectRepositoryRemote, default_ref AS defaultRef, base_commit AS baseCommit, fork_head AS forkHead, project_head AS projectHead, sync_status AS syncStatus, merge_status AS mergeStatus FROM app_workspace_vcs WHERE singleton = 1"
      )
      .toArray()[0]
  }

  #requiredState() {
    const state = this.#state()
    if (!state) throw new Error("Workspace version control is not initialized")
    return state
  }

  #checkpoint(id: string) {
    return this.#storage.sql
      .exec<CheckpointRow>(
        "SELECT id, commit_id AS commitId, message, created_at AS createdAt, status FROM app_workspace_checkpoint WHERE id = ?",
        id
      )
      .toArray()[0]
  }

  #checkpointValue(row: CheckpointRow) {
    return new WorkspaceCheckpoint({
      id: row.id,
      commit: GitCommitId.make(row.commitId),
      message: row.message,
      createdAt: row.createdAt,
    })
  }

  #completeCheckpoint(id: string, commit: string) {
    const state = this.#requiredState()
    const baseCommit =
      state.syncStatus === "diverged" ? state.projectHead : state.baseCommit
    this.#storage.sql.exec(
      "UPDATE app_workspace_checkpoint SET status = 'complete' WHERE id = ?",
      id
    )
    this.#storage.sql.exec(
      "UPDATE app_workspace_vcs SET base_commit = ?, fork_head = ?, sync_status = 'ready', merge_status = 'ready' WHERE singleton = 1",
      baseCommit,
      commit
    )
  }

  #markDiverged() {
    this.#storage.sql.exec(
      "UPDATE app_workspace_vcs SET sync_status = 'diverged' WHERE singleton = 1"
    )
  }
}
