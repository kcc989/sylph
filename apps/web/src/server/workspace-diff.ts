import {
  WorkspaceDiffResult,
  WorkspaceFileChange,
  type WorkspaceDiffScope,
  type WorkspaceVersionControl,
} from "@workspace/domain"

export const maxDiffPatchCharacters = 60_000

export const boundedFileChanges = (
  files: ReadonlyArray<WorkspaceFileChange>,
  limit = maxDiffPatchCharacters
) => {
  let remaining = limit
  let truncated = false
  const bounded = files.map((change) => {
    if (change.patch.length <= remaining) {
      remaining -= change.patch.length
      return change
    }
    truncated = true
    const patch =
      remaining > 0
        ? `${change.patch.slice(0, remaining)}\n…[patch truncated]`
        : `diff --git a/${change.file} b/${change.file}\n…[patch omitted]`
    remaining = 0
    return new WorkspaceFileChange({ ...change, patch })
  })
  return { files: bounded, truncated }
}

export const workspaceDiff = (
  versionControl: WorkspaceVersionControl,
  scope: WorkspaceDiffScope
) => {
  const source =
    scope === "working" ? versionControl.working : versionControl.branch
  const { files, truncated } = boundedFileChanges(source)
  return new WorkspaceDiffResult({
    scope,
    baseCommit: versionControl.baseCommit,
    forkHead: versionControl.forkHead,
    files,
    truncated,
  })
}
