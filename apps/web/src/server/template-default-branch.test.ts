import { expect, test } from "bun:test"
import { ensureTemplateDefaultBranch } from "./template-default-branch"

const commit = "bed6b52785eab6e79680041ee1367f2831f59296"
const input = {
  remote: "https://example.com/template.git",
  defaultBranch: "main",
  sourceRef: "codex/reliable-template-0.1.1",
  expectedCommit: commit,
  onAuth: () => ({ username: "x", password: "test-token" }),
}

const fixture = (
  refs: Array<{ ref: string; oid: string }>,
  clonedCommit = commit
) => {
  const pushes: Array<{ ref?: string; remoteRef?: string; force?: boolean }> =
    []
  let clones = 0
  const client: NonNullable<Parameters<typeof ensureTemplateDefaultBranch>[1]> =
    {
      listServerRefs: async () => refs,
      clone: async () => {
        clones += 1
      },
      resolveRef: async () => clonedCommit,
      push: async (options) => {
        pushes.push(options)
        return { ok: true, error: null, refs: {} }
      },
    }
  return { client, pushes, clones: () => clones }
}

test("creates a missing default branch at the verified imported release", async () => {
  const run = fixture([{ ref: `refs/heads/${input.sourceRef}`, oid: commit }])
  await ensureTemplateDefaultBranch(input, run.client)
  expect(run.clones()).toBe(1)
  expect(run.pushes).toHaveLength(1)
  expect(run.pushes[0]).toMatchObject({
    ref: input.sourceRef,
    remoteRef: "main",
    force: false,
  })
})

test("leaves an already repaired template unchanged", async () => {
  const run = fixture([{ ref: "refs/heads/main", oid: commit }])
  await ensureTemplateDefaultBranch(input, run.client)
  expect(run.clones()).toBe(0)
  expect(run.pushes).toEqual([])
})

test("does not replace an existing default branch at another commit", async () => {
  const run = fixture([{ ref: "refs/heads/main", oid: "a".repeat(40) }])
  await expect(ensureTemplateDefaultBranch(input, run.client)).rejects.toThrow(
    "verified release commit"
  )
  expect(run.clones()).toBe(0)
  expect(run.pushes).toEqual([])
})

test("rejects an absent or moved release branch before cloning", async () => {
  for (const refs of [
    [],
    [{ ref: `refs/heads/${input.sourceRef}`, oid: "a".repeat(40) }],
  ]) {
    const run = fixture(refs)
    await expect(
      ensureTemplateDefaultBranch(input, run.client)
    ).rejects.toThrow("verified release commit")
    expect(run.clones()).toBe(0)
    expect(run.pushes).toEqual([])
  }
})

test("rejects a release that moves between discovery and clone", async () => {
  const run = fixture(
    [{ ref: `refs/heads/${input.sourceRef}`, oid: commit }],
    "a".repeat(40)
  )
  await expect(ensureTemplateDefaultBranch(input, run.client)).rejects.toThrow(
    "verified release commit"
  )
  expect(run.clones()).toBe(1)
  expect(run.pushes).toEqual([])
})
