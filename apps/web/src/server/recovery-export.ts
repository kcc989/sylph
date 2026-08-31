import type { RepositoryAccess, StoredRepository } from "./repository-store"

interface RecoveryRepositoryMetadata {
  kind: "project" | "workspace"
  id: string
  title: string
  repositoryName: string
  baseCommit: string | null
  forkHead: string | null
  acceptedCommit: string | null
}

export const recoveryRepositoryEntry = (
  entry: RecoveryRepositoryMetadata,
  repository: StoredRepository,
  access: RepositoryAccess,
  headCommit: string
) => ({
  ...entry,
  forkHead: entry.kind === "workspace" ? headCommit : entry.forkHead,
  headCommit,
  repository,
  access,
})
