import { env } from "cloudflare:workers"

import { makeCloudflareArtifactsRepositoryStore } from "@/server/repository-store"

export const repositoryStore = () =>
  makeCloudflareArtifactsRepositoryStore(env.REPOS)
