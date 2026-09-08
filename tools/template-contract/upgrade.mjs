import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
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
  branch = "codex/template-contract-upgrade",
  bundleDirectory = dirname(patchPath)
) => {
  const cwd = resolve(repository)
  const target = resolve(destination)
  if (!branch.startsWith("codex/"))
    throw new Error("Use a new codex/ branch for the reviewed template upgrade")
  if (git(cwd, ["status", "--porcelain"]))
    throw new Error(
      "Commit or stash Project changes before preparing an upgrade"
    )
  const metadata = JSON.parse(
    readFileSync(resolve(bundleDirectory, "template-candidate.json"), "utf8")
  )
  let patch
  let selectedPatch
  for (const name of ["template-upgrade.patch", "template.patch"]) {
    const file = resolve(bundleDirectory, name)
    if (!existsSync(file)) continue
    const content = readFileSync(file, "utf8")
    const recorded = metadata.patches?.find((entry) => entry.name === name)
    if (
      metadata.patches &&
      (!recorded ||
        createHash("sha256").update(content).digest("hex") !== recorded.sha256)
    )
      throw new Error(`Template upgrade patch hash mismatch: ${name}`)
    if (!content.trim()) continue
    try {
      git(cwd, ["apply", "--check", "-"], content)
      patch = content
      selectedPatch = name
      break
    } catch {}
  }
  if (!patch)
    throw new Error(
      "No verified template patch applies cleanly. Prepare a manual reviewed upgrade without rewriting accepted history."
    )
  const baseCommit = git(cwd, ["rev-parse", "HEAD"])
  git(cwd, ["worktree", "add", "-b", branch, target, baseCommit])
  git(target, ["apply", "-"], patch)
  return { directory: target, branch, baseCommit, patch: selectedPatch }
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
