import { Schema } from "effect"
import { GitCommitId } from "./version-control"

export class DependencyInputFile extends Schema.Class<DependencyInputFile>(
  "@sylph/domain/DependencyInputFile"
)({ path: Schema.NonEmptyString, digest: Schema.NonEmptyString }) {}

export class DependencyRepairOutput extends Schema.Class<DependencyRepairOutput>(
  "@sylph/domain/DependencyRepairOutput"
)({
  inputs: Schema.Array(DependencyInputFile),
  lockfile: Schema.NonEmptyString,
}) {}

export class WorkspaceDependencyRepair extends Schema.Class<WorkspaceDependencyRepair>(
  "@sylph/domain/WorkspaceDependencyRepair"
)({
  runId: Schema.NonEmptyString,
  commit: GitCommitId,
  output: DependencyRepairOutput,
}) {}

export class DependencyRepairConflict extends Schema.TaggedError<DependencyRepairConflict>()(
  "DependencyRepairConflict",
  { message: Schema.String }
) {}

export const isDependencyInput = (path: string) =>
  path === "package.json" ||
  path.endsWith("/package.json") ||
  [
    "bun.lock",
    "bun.lockb",
    "bunfig.toml",
    ".npmrc",
    "pnpm-workspace.yaml",
  ].includes(path) ||
  path.startsWith("patches/")
