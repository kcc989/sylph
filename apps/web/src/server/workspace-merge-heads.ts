import git from "isomorphic-git"

import { MemoryFilesystem } from "./memory-filesystem"

const directory = "/workspace"
const author = { name: "Sylph", email: "accept@sylph.dev" }

export const acceptedOperationUpdateSql =
  "UPDATE repository_operation SET status = 'complete', \"commit\" = ?, error_summary = NULL, updated_at = unixepoch() WHERE id = ?"

export const acceptanceCanStart = (mergeStatus: string) =>
  mergeStatus === "ready" || mergeStatus === "error"

export const configureWorkspaceRemoteForAcceptance = (input: {
  filesystem: MemoryFilesystem
  remote: string
}) =>
  git.addRemote({
    fs: input.filesystem,
    dir: directory,
    remote: "workspace",
    url: input.remote,
    force: true,
  })

export const mergeWorkspaceHeads = async (input: {
  filesystem: MemoryFilesystem
  workspaceId: string
  defaultRef: string
  baseCommit: string
  projectHead: string
  forkHead: string
}) => {
  const alreadyAccepted = await git.isDescendent({
    fs: input.filesystem,
    dir: directory,
    oid: input.projectHead,
    ancestor: input.forkHead,
  })
  if (alreadyAccepted) return input.projectHead

  if (input.projectHead === input.baseCommit) {
    await git.writeRef({
      fs: input.filesystem,
      dir: directory,
      ref: `refs/heads/${input.defaultRef}`,
      value: input.forkHead,
      force: true,
    })
    return input.forkHead
  }

  const result = await git.merge({
    fs: input.filesystem,
    dir: directory,
    ours: input.projectHead,
    theirs: input.forkHead,
    fastForward: true,
    message: `Accept Workspace ${input.workspaceId}`,
    author,
  })
  if (!result.oid) throw new Error("Merge did not produce an accepted commit")
  return result.oid
}
