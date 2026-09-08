import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"

const patchPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../resource-management/template.patch"
)

const git = (cwd, args, input) => {
  const result = spawnSync("git", args, { cwd, input, encoding: "utf8" })
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || "Git command failed")
  return result.stdout.trim()
}

export const prepareTemplateUpgrade = (
  repository,
  destination,
  branch = "codex/template-contract-upgrade"
) => {
  const cwd = resolve(repository)
  const target = resolve(destination)
  if (!branch.startsWith("codex/"))
    throw new Error("Use a new codex/ branch for the reviewed template upgrade")
  if (git(cwd, ["status", "--porcelain"]))
    throw new Error(
      "Commit or stash Project changes before preparing an upgrade"
    )
  const patch = readFileSync(patchPath, "utf8")
  git(cwd, ["apply", "--check", "-"], patch)
  const baseCommit = git(cwd, ["rev-parse", "HEAD"])
  git(cwd, ["worktree", "add", "-b", branch, target, baseCommit])
  git(target, ["apply", "-"], patch)
  return { directory: target, branch, baseCommit }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [, , repository, destination, branch] = process.argv
  if (!repository || !destination)
    throw new Error(
      "Usage: bun tools/template-contract/upgrade.mjs <Project checkout> <new worktree> [codex/branch]"
    )
  console.log(
    JSON.stringify(prepareTemplateUpgrade(repository, destination, branch))
  )
  console.log(
    "Review the worktree diff, run the Project checks, then commit a new Checkpoint. Accept and deploy through the normal Project flow."
  )
}
