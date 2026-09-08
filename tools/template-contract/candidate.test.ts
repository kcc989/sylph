import { expect, test } from "bun:test"
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readFileSync,
  readdirSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import {
  generateTemplateCandidate,
  verifyControlSchema,
  verifyImmutableMigrations,
} from "./candidate.mjs"
import { createHash } from "node:crypto"

const baseSql =
  "CREATE TABLE sylph_recovery_gate (id INTEGER PRIMARY KEY, owner TEXT); INSERT INTO sylph_recovery_gate VALUES (1, NULL);"
const additiveSql =
  "CREATE TABLE recovery_group (id TEXT PRIMARY KEY, json TEXT);"

test("immutable migrations and actual applied recovery schema are independently verified", () => {
  const original = new Map([["recovery-migrations/0001.sql", baseSql]])
  expect(() =>
    verifyImmutableMigrations(
      original,
      new Map([...original, ["recovery-migrations/0002.sql", additiveSql]])
    )
  ).not.toThrow()
  expect(() =>
    verifyImmutableMigrations(
      original,
      new Map([["recovery-migrations/0001.sql", `${baseSql}${additiveSql}`]])
    )
  ).toThrow("Published migration changed")
  expect(() => verifyImmutableMigrations(original, new Map())).toThrow(
    "disappeared"
  )
  expect(() =>
    verifyControlSchema([baseSql, additiveSql], [baseSql + additiveSql])
  ).not.toThrow()
  expect(() => verifyControlSchema([baseSql], [baseSql + additiveSql])).toThrow(
    "differ"
  )
  expect(() =>
    verifyControlSchema(
      [baseSql.replace("(1, NULL)", "(1, 'locked')"), additiveSql],
      [baseSql + additiveSql]
    )
  ).toThrow("differ")
})

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}
const initialize = (directory: string) => {
  mkdirSync(directory)
  git(directory, "init", "-q")
  git(directory, "config", "commit.gpgsign", "false")
  git(directory, "config", "core.hooksPath", "/dev/null")
  git(directory, "config", "user.name", "Fixture")
  git(directory, "config", "user.email", "fixture@example.com")
}
const commit = (directory: string) => {
  git(directory, "add", ".")
  git(directory, "commit", "-qm", "fixture")
  return git(directory, "rev-parse", "HEAD")
}

test("candidate generation records deterministic immutable references and verified source provenance only", () => {
  const root = mkdtempSync(join(tmpdir(), "sylph-candidate-contract-"))
  try {
    const platform = join(root, "platform")
    const starter = join(root, "starter")
    const output = join(root, "bundle")
    initialize(platform)
    initialize(starter)
    writeFileSync(join(platform, "control.sql"), baseSql + additiveSql)
    writeFileSync(join(platform, "upgrade.sql"), additiveSql)
    writeFileSync(join(platform, "base.sql"), baseSql)
    const platformCommit = commit(platform)
    writeFileSync(join(starter, "package.json"), '{"version":"0.1.0"}\n')
    const baseCommit = commit(starter)
    mkdirSync(join(starter, "recovery-migrations"))
    writeFileSync(join(starter, "recovery-migrations/0001.sql"), baseSql)
    const previousCommit = commit(starter)
    writeFileSync(join(starter, "recovery-migrations/0002.sql"), additiveSql)
    writeFileSync(join(starter, "package.json"), '{"version":"0.3.0"}\n')
    const candidateCommit = commit(starter)
    const sourceMap = join(root, "mapping.json")
    writeFileSync(
      sourceMap,
      JSON.stringify({
        sources: [
          {
            templatePath: "recovery-migrations/0001.sql",
            platformPath: "base.sql",
          },
          {
            templatePath: "recovery-migrations/0002.sql",
            platformPath: "upgrade.sql",
          },
        ],
        rewrites: [],
        controlSchemas: ["control.sql"],
      })
    )
    const options = {
      platform,
      starter,
      output,
      baseCommit,
      previousCommit,
      version: "0.3.0",
      sourceMap,
    }
    const metadata = generateTemplateCandidate(options)
    expect(metadata.published).toBe(false)
    expect(metadata.candidateCommit).toBe(candidateCommit)
    const first = readFileSync(join(output, "template-candidate.json"), "utf8")
    generateTemplateCandidate(options)
    expect(readFileSync(join(output, "template-candidate.json"), "utf8")).toBe(
      first
    )
    expect(metadata.repository).toBe("kcc989/sylph-tanstack-template")
    expect(metadata.baseCommit).toBe(baseCommit)
    expect(metadata.previousCommit).toBe(previousCommit)
    expect(metadata.recoverySourceCommit).toBe(platformCommit)
    expect(metadata).not.toHaveProperty("patches")
    expect(metadata).not.toHaveProperty("candidateRef")
    expect(readdirSync(output)).toEqual(["template-candidate.json"])
    expect(metadata.recoverySources[0]).toEqual({
      templatePath: "recovery-migrations/0001.sql",
      platformPath: "base.sql",
      sourceCommit: platformCommit,
      sourceSha256: createHash("sha256").update(baseSql).digest("hex"),
      templateSha256: createHash("sha256").update(baseSql).digest("hex"),
    })
    expect(git(starter, "rev-parse", "HEAD")).toBe(candidateCommit)
    expect(git(starter, "status", "--porcelain")).toBe("")
    expect(git(platform, "rev-parse", "HEAD")).toBe(platformCommit)
    expect(git(platform, "status", "--porcelain")).toBe("")
    const mapping = JSON.parse(readFileSync(sourceMap, "utf8"))
    mapping.sources[0].platformPath = "upgrade.sql"
    writeFileSync(sourceMap, JSON.stringify(mapping))
    expect(() => generateTemplateCandidate(options)).toThrow(
      "Vendored source mismatch"
    )
    expect(readFileSync(join(output, "template-candidate.json"), "utf8")).toBe(
      first
    )
    writeFileSync(join(starter, "uncommitted"), "pending")
    expect(() => generateTemplateCandidate(options)).toThrow("clean committed")
    rmSync(join(starter, "uncommitted"))
    writeFileSync(
      join(starter, "recovery-migrations/0001.sql"),
      baseSql.replace("owner TEXT", "owner INTEGER")
    )
    commit(starter)
    expect(() => generateTemplateCandidate(options)).toThrow(
      "Published migration changed"
    )
    expect(readFileSync(join(output, "template-candidate.json"), "utf8")).toBe(
      first
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 60000)
