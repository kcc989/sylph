import {
  GitCommitId,
  WorkspaceCheckpoint,
  WorkspaceCheckpointResult,
  WorkspaceFileChange,
  WorkspaceVersionControl,
} from "@workspace/domain"
import { createTwoFilesPatch } from "diff"
import git from "isomorphic-git"
import http from "isomorphic-git/http/web"

import {
  WorkspaceFilesystem,
  type WorkspaceStorage,
} from "./workspace-filesystem"

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

const tokenSecret = (token: string) => token.split("?expires=")[0]

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

const artifactAuth = (plaintext: string) => () => ({
  username: "x",
  password: tokenSecret(plaintext),
})

export const isRepositoryMetadata = (file: string) =>
  file === ".git" || file.startsWith(".git/")

export class WorkspaceGit {
  readonly #storage: WorkspaceStorage
  readonly #repositories: Artifacts
  readonly #filesystem: WorkspaceFilesystem

  constructor(
    storage: WorkspaceStorage,
    repositories: Artifacts,
    filesystem: WorkspaceFilesystem
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

  async prepareProject(input: {
    repositoryName: string
    repositoryRemote: string
    defaultRef: string
    projectName: string
  }) {
    this.#filesystem.clear()
    const repository = await this.#repositories.get(input.repositoryName)
    const token = await repository.createToken("write", 300)
    const refs = await git.listServerRefs({
      http,
      url: input.repositoryRemote,
      prefix: `refs/heads/${input.defaultRef}`,
      onAuth: artifactAuth(token.plaintext),
    })
    const head = refs.find(
      (ref) => ref.ref === `refs/heads/${input.defaultRef}`
    )?.oid

    if (head) {
      await git.clone({
        fs: this.#filesystem,
        http,
        dir: directory,
        url: input.repositoryRemote,
        ref: input.defaultRef,
        singleBranch: true,
        noTags: true,
        onAuth: artifactAuth(token.plaintext),
      })
      return GitCommitId.make(head)
    }

    await git.init({
      fs: this.#filesystem,
      dir: directory,
      defaultBranch: input.defaultRef,
    })
    await this.#filesystem.writeFile(
      `${directory}/README.md`,
      `# ${input.projectName}\n\nBuilt in a durable Sylph Workspace.\n`
    )
    await this.#filesystem.writeFile(
      `${directory}/package.json`,
      `${JSON.stringify(
        {
          name: input.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          private: true,
          type: "module",
        },
        null,
        2
      )}\n`
    )
    await git.add({
      fs: this.#filesystem,
      dir: directory,
      filepath: "README.md",
    })
    await git.add({
      fs: this.#filesystem,
      dir: directory,
      filepath: "package.json",
    })
    const commit = await git.commit({
      fs: this.#filesystem,
      dir: directory,
      message: "Create Project Repository",
      author,
    })
    await git.push({
      fs: this.#filesystem,
      http,
      dir: directory,
      url: input.repositoryRemote,
      ref: input.defaultRef,
      remoteRef: input.defaultRef,
      force: false,
      onAuth: artifactAuth(token.plaintext),
    })
    return GitCommitId.make(commit)
  }

  async hydrate(input: {
    repositoryName: string
    repositoryRemote: string
    projectRepositoryName: string
    projectRepositoryRemote: string
    defaultRef: string
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
    const refs = await git.listServerRefs({
      http,
      url: input.repositoryRemote,
      prefix: `refs/heads/${input.defaultRef}`,
      onAuth: artifactAuth(token.plaintext),
    })
    const workspaceHead = refs.find(
      (ref) => ref.ref === `refs/heads/${input.defaultRef}`
    )?.oid

    if (workspaceHead) {
      await git.clone({
        fs: this.#filesystem,
        http,
        dir: directory,
        url: input.repositoryRemote,
        ref: input.defaultRef,
        singleBranch: true,
        noTags: true,
        onAuth: artifactAuth(token.plaintext),
      })
    } else {
      const projectRepository = await this.#repositories.get(
        input.projectRepositoryName
      )
      const projectToken = await projectRepository.createToken("read", 300)
      await git.clone({
        fs: this.#filesystem,
        http,
        dir: directory,
        url: input.projectRepositoryRemote,
        ref: input.defaultRef,
        singleBranch: true,
        noTags: true,
        onAuth: artifactAuth(projectToken.plaintext),
      })
      await git.push({
        fs: this.#filesystem,
        http,
        dir: directory,
        url: input.repositoryRemote,
        ref: input.defaultRef,
        remoteRef: input.defaultRef,
        force: false,
        onAuth: artifactAuth(token.plaintext),
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
      ? await this.#readProjectHead(state).catch(() => state.projectHead)
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
    const remoteHead = await this.#remoteHead(
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
      if (remoteHead !== state.forkHead) {
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

    if (remoteHead !== state.forkHead) {
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
    const commit = await git.commit({
      fs: this.#filesystem,
      dir: directory,
      message: input.message,
      author,
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

  checkpoints() {
    return this.#storage.sql
      .exec<CheckpointRow>(
        "SELECT id, commit_id AS commitId, message, created_at AS createdAt, status FROM app_workspace_checkpoint WHERE status = 'complete' ORDER BY created_at DESC"
      )
      .toArray()
      .map((row) => this.#checkpointValue(row))
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
    const refs = await git.listServerRefs({
      http,
      url: remote,
      prefix: `refs/heads/${ref}`,
      forPush,
      onAuth: artifactAuth(plaintext),
    })
    const head = refs.find((candidate) => candidate.ref === `refs/heads/${ref}`)
    if (!head) throw new Error("Workspace fork default ref is missing")
    return head.oid
  }

  async #readProjectHead(state: WorkspaceGitState) {
    const repository = await this.#repositories.get(state.projectRepositoryName)
    const token = await repository.createToken("read", 300)
    return this.#remoteHead(
      state.projectRepositoryRemote,
      state.defaultRef,
      token.plaintext,
      false
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
    this.#storage.sql.exec(
      "UPDATE app_workspace_checkpoint SET status = 'complete' WHERE id = ?",
      id
    )
    this.#storage.sql.exec(
      "UPDATE app_workspace_vcs SET fork_head = ?, sync_status = 'ready', merge_status = 'ready' WHERE singleton = 1",
      commit
    )
  }

  #markDiverged() {
    this.#storage.sql.exec(
      "UPDATE app_workspace_vcs SET sync_status = 'diverged' WHERE singleton = 1"
    )
  }
}
