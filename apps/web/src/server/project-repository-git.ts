import {
  GitCommitId,
  type PrepareProjectRepositoryInput,
  type SyncProjectRepositoryInput,
  SyncProjectRepositoryResult,
} from "@workspace/domain"
import git from "isomorphic-git"
import http from "isomorphic-git/http/web"

import { MemoryFilesystem } from "./memory-filesystem"
import { artifactAuth, type RepositoryNamespace } from "./repository-store"

const directory = "/workspace"
const author = { name: "Sylph", email: "checkpoints@sylph.dev" }

export type ListRemoteRefs = (
  input: Parameters<typeof git.listServerRefs>[0]
) => Promise<Array<{ ref: string; oid: string }>>

type RemoteAuth = ReturnType<typeof artifactAuth> | undefined

const remoteHead = async (
  listRefs: ListRemoteRefs,
  url: string,
  ref: string,
  onAuth: RemoteAuth
) => {
  const refs = await listRefs({
    http,
    url,
    prefix: `refs/heads/${ref}`,
    protocolVersion: 2,
    onAuth,
  })
  return refs.find((candidate) => candidate.ref === `refs/heads/${ref}`)?.oid
}

export const projectRepositorySyncStatus = async (
  filesystem: MemoryFilesystem,
  projectHead: string,
  upstreamHead: string
) => {
  if (projectHead === upstreamHead) return "up_to_date" as const
  if (
    await git.isDescendent({
      fs: filesystem,
      dir: directory,
      oid: upstreamHead,
      ancestor: projectHead,
    })
  ) {
    return "fast_forwarded" as const
  }
  if (
    await git.isDescendent({
      fs: filesystem,
      dir: directory,
      oid: projectHead,
      ancestor: upstreamHead,
    })
  ) {
    return "ahead" as const
  }
  return "diverged" as const
}

export const prepareProjectRepository = async (
  repositories: RepositoryNamespace,
  input: PrepareProjectRepositoryInput
) => {
  const repository = await repositories.get(input.repositoryName)
  const token = await repository.createToken("write", 300)
  const onAuth = artifactAuth(token.plaintext)
  const head = await remoteHead(
    git.listServerRefs,
    input.repositoryRemote,
    input.defaultRef,
    onAuth
  )
  if (head) return GitCommitId.make(head)

  const filesystem = new MemoryFilesystem()

  if (input.source) {
    await git.clone({
      fs: filesystem,
      http,
      dir: directory,
      url: input.source.remote,
      ref: input.source.ref,
      singleBranch: true,
      noTags: false,
      onAuth: input.source.accessToken
        ? artifactAuth(input.source.accessToken)
        : undefined,
    })
    const importedHead = await git.resolveRef({
      fs: filesystem,
      dir: directory,
      ref: "HEAD",
    })
    await git.push({
      fs: filesystem,
      http,
      dir: directory,
      url: input.repositoryRemote,
      ref: input.source.ref,
      remoteRef: input.defaultRef,
      force: false,
      onAuth,
    })
    return GitCommitId.make(importedHead)
  }

  await git.init({
    fs: filesystem,
    dir: directory,
    defaultBranch: input.defaultRef,
  })
  await filesystem.writeFile(
    `${directory}/README.md`,
    `# ${input.projectName}\n\nBuilt in a durable Sylph Workspace.\n`
  )
  await filesystem.writeFile(
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
  await git.add({ fs: filesystem, dir: directory, filepath: "README.md" })
  await git.add({ fs: filesystem, dir: directory, filepath: "package.json" })
  const commit = await git.commit({
    fs: filesystem,
    dir: directory,
    message: "Create Project Repository",
    author,
  })
  await git.push({
    fs: filesystem,
    http,
    dir: directory,
    url: input.repositoryRemote,
    ref: input.defaultRef,
    remoteRef: input.defaultRef,
    force: false,
    onAuth,
  })
  return GitCommitId.make(commit)
}

export const syncProjectRepository = async (
  repositories: RepositoryNamespace,
  input: SyncProjectRepositoryInput,
  listRefs: ListRemoteRefs = git.listServerRefs,
  previous?: SyncProjectRepositoryResult
) => {
  const repository = await repositories.get(input.repositoryName)
  const token = await repository.createToken("write", 300)
  const onAuth = artifactAuth(token.plaintext)
  const sourceAuth = input.sourceAccessToken
    ? artifactAuth(input.sourceAccessToken)
    : undefined
  const [projectHead, upstreamHead] = await Promise.all([
    remoteHead(listRefs, input.repositoryRemote, input.defaultRef, onAuth),
    remoteHead(listRefs, input.sourceRemote, input.sourceRef, sourceAuth),
  ])
  if (!projectHead) {
    throw new Error("Project Repository default ref is missing")
  }
  if (!upstreamHead) throw new Error("Upstream Repository ref is missing")
  if (projectHead === upstreamHead) {
    return new SyncProjectRepositoryResult({
      status: "up_to_date",
      projectHead: GitCommitId.make(projectHead),
      upstreamHead: GitCommitId.make(upstreamHead),
    })
  }

  if (
    previous?.projectHead === projectHead &&
    previous.upstreamHead === upstreamHead
  ) {
    return previous
  }

  const filesystem = new MemoryFilesystem()
  await git.clone({
    fs: filesystem,
    http,
    dir: directory,
    url: input.repositoryRemote,
    ref: input.defaultRef,
    singleBranch: true,
    noTags: false,
    onAuth,
  })
  const clonedProjectHead = await git.resolveRef({
    fs: filesystem,
    dir: directory,
    ref: "HEAD",
  })
  await git.addRemote({
    fs: filesystem,
    dir: directory,
    remote: "upstream",
    url: input.sourceRemote,
    force: true,
  })
  await git.fetch({
    fs: filesystem,
    http,
    dir: directory,
    remote: "upstream",
    ref: input.sourceRef,
    singleBranch: true,
    tags: true,
    onAuth: sourceAuth,
  })
  const fetchedUpstreamHead = await git.resolveRef({
    fs: filesystem,
    dir: directory,
    ref: `refs/remotes/upstream/${input.sourceRef}`,
  })
  const status = await projectRepositorySyncStatus(
    filesystem,
    clonedProjectHead,
    fetchedUpstreamHead
  )
  if (status === "fast_forwarded") {
    await git.writeRef({
      fs: filesystem,
      dir: directory,
      ref: `refs/heads/${input.defaultRef}`,
      value: fetchedUpstreamHead,
      force: true,
    })
    await git.checkout({
      fs: filesystem,
      dir: directory,
      ref: input.defaultRef,
      force: true,
    })
    await git.push({
      fs: filesystem,
      http,
      dir: directory,
      url: input.repositoryRemote,
      ref: input.defaultRef,
      remoteRef: input.defaultRef,
      force: false,
      onAuth,
    })
  }
  return new SyncProjectRepositoryResult({
    status,
    projectHead: GitCommitId.make(
      status === "fast_forwarded" ? fetchedUpstreamHead : clonedProjectHead
    ),
    upstreamHead: GitCommitId.make(fetchedUpstreamHead),
  })
}
