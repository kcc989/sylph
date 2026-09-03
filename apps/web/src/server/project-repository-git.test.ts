import { describe, expect, test } from "bun:test"
import { GitCommitId, SyncProjectRepositoryInput } from "@workspace/domain"
import git from "isomorphic-git"

import { MemoryFilesystem } from "./memory-filesystem"
import {
  type ListRemoteRefs,
  projectRepositorySyncStatus,
  syncProjectRepository,
} from "./project-repository-git"
import type { RepositoryNamespace } from "./repository-store"

const directory = "/workspace"
const author = { name: "Sylph", email: "test@sylph.dev" }
const projectOid = GitCommitId.make("1111111111111111111111111111111111111111")
const upstreamOid = GitCommitId.make("2222222222222222222222222222222222222222")

const repositories: RepositoryNamespace = {
  create: async () => {
    throw new Error("Unexpected create")
  },
  import: async () => {
    throw new Error("Unexpected import")
  },
  delete: async () => {
    throw new Error("Unexpected delete")
  },
  get: async (name) => ({
    id: "project-id",
    name,
    remote: "https://repositories.example/project",
    defaultBranch: "main",
    createToken: async () => ({ plaintext: "token", expiresAt: "later" }),
    fork: async () => {
      throw new Error("Unexpected fork")
    },
  }),
}

const input = new SyncProjectRepositoryInput({
  repositoryName: "project",
  repositoryRemote: "https://repositories.example/project",
  defaultRef: "main",
  sourceRemote: "https://github.com/acme/project.git",
  sourceRef: "main",
})

const commitFile = async (
  filesystem: MemoryFilesystem,
  path: string,
  content: string
) => {
  await filesystem.writeFile(`${directory}/${path}`, content)
  await git.add({ fs: filesystem, dir: directory, filepath: path })
  return git.commit({ fs: filesystem, dir: directory, message: path, author })
}

describe("syncProjectRepository", () => {
  test("reports an up-to-date Project without cloning when both heads match", async () => {
    const listed: string[] = []
    const listRefs: ListRemoteRefs = async ({ url, prefix }) => {
      listed.push(url)
      return [{ ref: prefix ?? "", oid: projectOid }]
    }

    const result = await syncProjectRepository(repositories, input, listRefs)

    expect(result.status).toBe("up_to_date")
    expect(result.projectHead).toBe(projectOid)
    expect(result.upstreamHead).toBe(projectOid)
    expect(listed.sort()).toEqual([
      "https://github.com/acme/project.git",
      "https://repositories.example/project",
    ])
  })

  test("fails clearly when the upstream branch no longer exists", async () => {
    const listRefs: ListRemoteRefs = async ({ url, prefix }) =>
      url.startsWith("https://github.com")
        ? []
        : [{ ref: prefix ?? "", oid: upstreamOid }]

    await expect(
      syncProjectRepository(repositories, input, listRefs)
    ).rejects.toThrow("Upstream Repository ref is missing")
  })
})

describe("projectRepositorySyncStatus", () => {
  test("classifies the Project head against the upstream head", async () => {
    const filesystem = new MemoryFilesystem()
    await git.init({ fs: filesystem, dir: directory, defaultBranch: "main" })
    const base = await commitFile(filesystem, "base.txt", "base\n")
    const next = await commitFile(filesystem, "next.txt", "next\n")
    await git.checkout({ fs: filesystem, dir: directory, ref: base })
    await git.branch({
      fs: filesystem,
      dir: directory,
      ref: "sidetrack",
      checkout: true,
    })
    const diverged = await commitFile(filesystem, "side.txt", "side\n")

    expect(await projectRepositorySyncStatus(filesystem, base, base)).toBe(
      "up_to_date"
    )
    expect(await projectRepositorySyncStatus(filesystem, base, next)).toBe(
      "fast_forwarded"
    )
    expect(await projectRepositorySyncStatus(filesystem, next, base)).toBe(
      "ahead"
    )
    expect(await projectRepositorySyncStatus(filesystem, next, diverged)).toBe(
      "diverged"
    )
  })
})
