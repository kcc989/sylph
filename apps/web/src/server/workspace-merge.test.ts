import { describe, expect, test } from "bun:test"
import git from "isomorphic-git"

import { MemoryFilesystem } from "./memory-filesystem"
import { mergeWorkspaceHeads } from "./workspace-merge-heads"

const directory = "/workspace"
const author = { name: "Sylph", email: "test@sylph.dev" }

const commitFile = async (
  filesystem: MemoryFilesystem,
  path: string,
  content: string,
  message: string
) => {
  await filesystem.writeFile(`${directory}/${path}`, content)
  await git.add({ fs: filesystem, dir: directory, filepath: path })
  return git.commit({ fs: filesystem, dir: directory, message, author })
}

const repository = async () => {
  const filesystem = new MemoryFilesystem()
  await git.init({ fs: filesystem, dir: directory, defaultBranch: "main" })
  const baseCommit = await commitFile(
    filesystem,
    "shared.txt",
    "base\n",
    "Baseline"
  )
  await git.branch({ fs: filesystem, dir: directory, ref: "workspace" })
  return { filesystem, baseCommit }
}

describe("mergeWorkspaceHeads", () => {
  test("creates a clean three-way accepted commit", async () => {
    const { filesystem, baseCommit } = await repository()
    await git.checkout({ fs: filesystem, dir: directory, ref: "workspace" })
    const forkHead = await commitFile(
      filesystem,
      "workspace.txt",
      "workspace\n",
      "Workspace change"
    )
    await git.checkout({ fs: filesystem, dir: directory, ref: "main" })
    const projectHead = await commitFile(
      filesystem,
      "project.txt",
      "project\n",
      "Project change"
    )

    const acceptedCommit = await mergeWorkspaceHeads({
      filesystem,
      workspaceId: "workspace-1",
      defaultRef: "main",
      baseCommit,
      projectHead,
      forkHead,
    })
    const workspaceFile = await git.readBlob({
      fs: filesystem,
      dir: directory,
      oid: acceptedCommit,
      filepath: "workspace.txt",
    })
    const projectFile = await git.readBlob({
      fs: filesystem,
      dir: directory,
      oid: acceptedCommit,
      filepath: "project.txt",
    })

    expect(new TextDecoder().decode(workspaceFile.blob)).toBe("workspace\n")
    expect(new TextDecoder().decode(projectFile.blob)).toBe("project\n")
  })

  test("returns a conflict without replacing the Project ref", async () => {
    const { filesystem, baseCommit } = await repository()
    await git.checkout({ fs: filesystem, dir: directory, ref: "workspace" })
    const forkHead = await commitFile(
      filesystem,
      "shared.txt",
      "workspace\n",
      "Workspace change"
    )
    await git.checkout({ fs: filesystem, dir: directory, ref: "main" })
    const projectHead = await commitFile(
      filesystem,
      "shared.txt",
      "project\n",
      "Project change"
    )

    await expect(
      mergeWorkspaceHeads({
        filesystem,
        workspaceId: "workspace-1",
        defaultRef: "main",
        baseCommit,
        projectHead,
        forkHead,
      })
    ).rejects.toBeDefined()
    expect(
      await git.resolveRef({ fs: filesystem, dir: directory, ref: "main" })
    ).toBe(projectHead)
  })
})
