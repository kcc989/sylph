import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const run = (cwd, command, args, input) => {
  const result = spawnSync(command, args, { cwd, input, encoding: "utf8" })
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || `${command} failed`)
  return result.stdout
}
const git = (cwd, ...args) => run(cwd, "git", args)
const hash = (value) => createHash("sha256").update(value).digest("hex")
const blob = (cwd, revision, path) => git(cwd, "show", `${revision}:${path}`)
const paths = (cwd, revision) =>
  git(cwd, "ls-tree", "-r", "--name-only", revision)
    .trim()
    .split("\n")
    .filter(Boolean)
const checkedPath = (path) => {
  if (
    !path ||
    path.startsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Source mapping requires a repository-relative path")
  return path
}

export const verifyControlSchema = (migrations, schemas) => {
  const inspect = (statements) => {
    const database = new Database(":memory:")
    try {
      for (const sql of statements) database.exec(sql)
      return {
        schema: database
          .query(
            "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name"
          )
          .all()
          .map((row) => ({
            ...row,
            sql: row.sql?.replace(/\s+/g, " ").trim(),
          })),
        gate: database
          .query("SELECT * FROM sylph_recovery_gate ORDER BY id")
          .all(),
      }
    } finally {
      database.close()
    }
  }
  if (JSON.stringify(inspect(migrations)) !== JSON.stringify(inspect(schemas)))
    throw new Error(
      "Applied starter recovery migrations differ from the platform control schema"
    )
}

export const generateTemplateCandidate = ({
  platform,
  starter,
  version,
  output,
  sourceMap,
}) => {
  platform = resolve(platform)
  starter = resolve(starter)
  output = resolve(output)
  if (
    [platform, starter].some(
      (repository) =>
        output === repository || output.startsWith(`${repository}/`)
    )
  )
    throw new Error(
      "Write candidate metadata outside the platform and starter checkouts"
    )
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
    throw new Error("Use an explicit candidate release version")
  for (const repository of [platform, starter])
    if (git(repository, "status", "--porcelain").trim())
      throw new Error(
        "Candidate generation requires clean committed platform and starter trees"
      )
  const candidateCommit = git(starter, "rev-parse", "HEAD").trim()
  const sourceCommit = git(platform, "rev-parse", "HEAD").trim()
  if (
    JSON.parse(blob(starter, candidateCommit, "package.json")).version !==
    version
  )
    throw new Error("Candidate version differs from its package version")
  const mapping = JSON.parse(
    readFileSync(
      sourceMap ??
        join(toolRoot, "tools/template-contract/candidate-sources.json"),
      "utf8"
    )
  )
  const candidatePaths = paths(starter, candidateCommit)
  const recoverySources = mapping.sources.map((entry) => {
    checkedPath(entry.templatePath)
    checkedPath(entry.platformPath)
    const revision = entry.platformRef ?? sourceCommit
    if (!/^[a-f0-9]{40}$/.test(revision))
      throw new Error("Source provenance requires immutable commits")
    const source = blob(platform, revision, entry.platformPath)
    const template = blob(starter, candidateCommit, entry.templatePath)
    let expected = source
    if (entry.templatePath.endsWith(".ts")) {
      for (const [from, to] of mapping.rewrites)
        expected = expected.replaceAll(`"${from}"`, `"${to}"`)
      expected = run(
        toolRoot,
        join(toolRoot, "node_modules/.bin/oxfmt"),
        ["--stdin-filepath", entry.templatePath],
        expected
      )
    }
    if (expected !== template)
      throw new Error(`Vendored source mismatch: ${entry.templatePath}`)
    return {
      ...entry,
      sourceCommit: revision,
      sourceSha256: hash(source),
      templateSha256: hash(template),
    }
  })
  const recoveryMigrations = candidatePaths
    .filter((path) => /^recovery-migrations\/.*\.sql$/.test(path))
    .sort()
  for (const path of recoveryMigrations)
    if (!recoverySources.some((entry) => entry.templatePath === path))
      throw new Error(`Missing migration source mapping: ${path}`)
  verifyControlSchema(
    recoveryMigrations.map((path) => blob(starter, candidateCommit, path)),
    mapping.controlSchemas.map((path) =>
      blob(platform, sourceCommit, checkedPath(path))
    )
  )
  const metadata = {
    repository: "kcc989/sylph-tanstack-template",
    candidateCommit,
    version,
    published: false,
    recoverySourceCommit: sourceCommit,
    sourceMapSha256: hash(JSON.stringify(mapping)),
    importRewrites: mapping.rewrites,
    controlSchemas: mapping.controlSchemas.map((path) => ({
      path,
      sourceCommit,
      sha256: hash(blob(platform, sourceCommit, path)),
    })),
    recoverySources,
    recoveryMigrations: recoveryMigrations.map((path) => ({
      path,
      sha256: hash(blob(starter, candidateCommit, path)),
    })),
  }
  mkdirSync(output, { recursive: true })
  writeFileSync(
    join(output, "template-candidate.json"),
    `${JSON.stringify(metadata, null, 2)}\n`
  )
  return metadata
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [, , platform, starter, version, output, sourceMap] = process.argv
  if (!output)
    throw new Error(
      "Usage: bun tools/template-contract/candidate.mjs <platform> <starter> <version> <output-directory> [source-map.json]"
    )
  console.log(
    JSON.stringify(
      generateTemplateCandidate({
        platform,
        starter,
        version,
        output: resolve(output),
        sourceMap,
      })
    )
  )
}
