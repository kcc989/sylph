import { createServerFn } from "@tanstack/react-start"
import { schema } from "@workspace/db"
import {
  normalizeSearchQuery,
  rankSearchResults,
  SearchQueryInput,
  SearchResultList,
  type RankableSearchResult,
  type SearchResult,
} from "@workspace/domain"
import { eq } from "drizzle-orm"
import { Schema } from "effect"

import { authenticated } from "@/functions/middleware"
import {
  buildEntityMembershipPredicate,
  buildEntitySearchPredicates,
} from "@/server/entity-search"

const decodeSearchQueryInput = Schema.decodeUnknownPromise(SearchQueryInput)
const decodeSearchResultList = Schema.decodeUnknownPromise(SearchResultList)
const encodeSearchResultList = Schema.encodePromise(SearchResultList)

const stripRankingFields = (result: RankableSearchResult): SearchResult => {
  if (result.kind === "project") {
    return {
      kind: result.kind,
      id: result.id,
      name: result.name,
      slug: result.slug,
    }
  }
  if (result.kind === "workspace") {
    return {
      kind: result.kind,
      id: result.id,
      projectId: result.projectId,
      projectSlug: result.projectSlug,
      projectName: result.projectName,
      title: result.title,
      status: result.status,
    }
  }
  return {
    kind: result.kind,
    id: result.id,
    projectId: result.projectId,
    projectSlug: result.projectSlug,
    projectName: result.projectName,
    number: result.number,
    title: result.title,
    status: result.status,
  }
}

export const searchEntities = createServerFn({ method: "GET" })
  .middleware([authenticated])
  .validator((input) => decodeSearchQueryInput(input))
  .handler(async ({ data, context }) => {
    const query = normalizeSearchQuery(data.query)
    const predicates = query ? buildEntitySearchPredicates(query) : null
    if (!query || !predicates) return encodeSearchResultList([])
    const requestedKinds = new Set(
      data.kinds ?? (["project", "workspace", "issue"] as const)
    )
    const limit = data.limit ?? 20
    const membership = buildEntityMembershipPredicate(context.user.id)
    const projectQuery = requestedKinds.has("project")
      ? context.database
          .select({
            id: schema.project.id,
            name: schema.project.name,
            slug: schema.project.slug,
            updatedAt: schema.project.updatedAt,
          })
          .from(schema.project)
          .innerJoin(schema.member, membership)
          .where(predicates.project)
          .limit(limit)
      : Promise.resolve([])
    const workspaceQuery = requestedKinds.has("workspace")
      ? context.database
          .select({
            id: schema.workspace.id,
            projectId: schema.workspace.projectId,
            projectSlug: schema.project.slug,
            projectName: schema.project.name,
            title: schema.workspace.title,
            status: schema.workspace.status,
            updatedAt: schema.workspace.updatedAt,
          })
          .from(schema.workspace)
          .innerJoin(
            schema.project,
            eq(schema.project.id, schema.workspace.projectId)
          )
          .innerJoin(schema.member, membership)
          .where(predicates.workspace)
          .limit(limit)
      : Promise.resolve([])
    const issueQuery = requestedKinds.has("issue")
      ? context.database
          .select({
            id: schema.issue.id,
            projectId: schema.issue.projectId,
            projectSlug: schema.project.slug,
            projectName: schema.project.name,
            number: schema.issue.number,
            title: schema.issue.title,
            status: schema.issue.status,
            updatedAt: schema.issue.updatedAt,
          })
          .from(schema.issue)
          .innerJoin(
            schema.project,
            eq(schema.project.id, schema.issue.projectId)
          )
          .innerJoin(schema.member, membership)
          .where(predicates.issue)
          .limit(limit)
      : Promise.resolve([])
    const [projects, workspaces, issues] = await Promise.all([
      projectQuery,
      workspaceQuery,
      issueQuery,
    ])
    const candidates = [
      ...projects.map((project) => ({
        kind: "project" as const,
        id: project.id,
        name: project.name,
        slug: project.slug,
        updatedAt: project.updatedAt.getTime(),
      })),
      ...workspaces.map((workspace) => ({
        kind: "workspace" as const,
        id: workspace.id,
        projectId: workspace.projectId,
        projectSlug: workspace.projectSlug,
        projectName: workspace.projectName,
        title: workspace.title,
        status: workspace.status,
        updatedAt: workspace.updatedAt.getTime(),
      })),
      ...issues.map((issue) => ({
        kind: "issue" as const,
        id: issue.id,
        projectId: issue.projectId,
        projectSlug: issue.projectSlug,
        projectName: issue.projectName,
        number: issue.number,
        title: issue.title,
        status: issue.status,
        updatedAt: issue.updatedAt.getTime(),
      })),
    ]
    const decoded = await decodeSearchResultList(candidates)
    const results: RankableSearchResult[] = decoded.map((result, index) => ({
      ...result,
      updatedAt: candidates[index]?.updatedAt ?? 0,
    }))
    const ranked = rankSearchResults(query, results)
      .slice(0, limit)
      .map(stripRankingFields)
    return encodeSearchResultList(await decodeSearchResultList(ranked))
  })
