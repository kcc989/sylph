import git from "isomorphic-git"
import http from "isomorphic-git/http/web"

import { MemoryFilesystem } from "./memory-filesystem"

export const ensureTemplateDefaultBranch = async (
  input: {
    remote: string
    defaultBranch: string
    sourceRef: string
    expectedCommit: string
    onAuth: NonNullable<Parameters<typeof git.clone>[0]["onAuth"]>
  },
  client: Pick<
    typeof git,
    "listServerRefs" | "clone" | "resolveRef" | "push"
  > = git
) => {
  const refs = await client.listServerRefs({
    http,
    url: input.remote,
    protocolVersion: 2,
    onAuth: input.onAuth,
  })
  const defaultHead = refs.find(
    (ref) => ref.ref === `refs/heads/${input.defaultBranch}`
  )
  if (defaultHead) {
    if (defaultHead.oid !== input.expectedCommit) {
      throw new Error(
        "The imported template does not match the verified release commit"
      )
    }
    return
  }
  const sourceHead = refs.find(
    (ref) => ref.ref === `refs/heads/${input.sourceRef}`
  )
  if (sourceHead?.oid !== input.expectedCommit) {
    throw new Error(
      "The imported template does not match the verified release commit"
    )
  }
  const fs = new MemoryFilesystem()
  const dir = "/template"
  await client.clone({
    fs,
    http,
    dir,
    url: input.remote,
    ref: input.sourceRef,
    singleBranch: true,
    noCheckout: true,
    onAuth: input.onAuth,
  })
  if (
    (await client.resolveRef({ fs, dir, ref: "HEAD" })) !== input.expectedCommit
  ) {
    throw new Error(
      "The imported template does not match the verified release commit"
    )
  }
  await client.push({
    fs,
    http,
    dir,
    url: input.remote,
    ref: input.sourceRef,
    remoteRef: input.defaultBranch,
    force: false,
    onAuth: input.onAuth,
  })
}
