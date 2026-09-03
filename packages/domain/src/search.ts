import { Effect, Schema } from "effect"

import { IssueStatus } from "./issue"
import { IssueId, ProjectId, WorkspaceId } from "./ids"
import { WorkspaceStatus } from "./workspace"

export const SearchResultKind = Schema.Literals([
  "project",
  "workspace",
  "issue",
])
export type SearchResultKind = typeof SearchResultKind.Type

const SearchLimit = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 50 })
)

export class SearchQueryInput extends Schema.Class<SearchQueryInput>(
  "@sylph/domain/SearchQueryInput"
)({
  query: Schema.NonEmptyString,
  limit: SearchLimit.pipe(
    Schema.optional,
    Schema.withDecodingDefault(Effect.succeed(20))
  ),
  kinds: Schema.optional(Schema.Array(SearchResultKind)),
}) {}

export class ProjectSearchResult extends Schema.Class<ProjectSearchResult>(
  "@sylph/domain/ProjectSearchResult"
)({
  kind: Schema.Literal("project"),
  id: ProjectId,
  name: Schema.NonEmptyString,
  slug: Schema.NonEmptyString,
}) {}

export class WorkspaceSearchResult extends Schema.Class<WorkspaceSearchResult>(
  "@sylph/domain/WorkspaceSearchResult"
)({
  kind: Schema.Literal("workspace"),
  id: WorkspaceId,
  projectId: ProjectId,
  projectSlug: Schema.NonEmptyString,
  projectName: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  status: WorkspaceStatus,
}) {}

export class IssueSearchResult extends Schema.Class<IssueSearchResult>(
  "@sylph/domain/IssueSearchResult"
)({
  kind: Schema.Literal("issue"),
  id: IssueId,
  projectId: ProjectId,
  projectSlug: Schema.NonEmptyString,
  projectName: Schema.NonEmptyString,
  number: Schema.Int,
  title: Schema.NonEmptyString,
  status: IssueStatus,
}) {}

export const SearchResult = Schema.Union([
  ProjectSearchResult,
  WorkspaceSearchResult,
  IssueSearchResult,
])
export type SearchResult = typeof SearchResult.Type

export const SearchResultList = Schema.Array(SearchResult)
export type SearchResultList = typeof SearchResultList.Type

export type RankableSearchResult = SearchResult & { readonly updatedAt: number }

export const normalizeSearchQuery = (raw: string) => {
  const normalized = raw.trim().replaceAll(/\s+/g, " ").toLowerCase()
  return normalized.length > 0 ? normalized : null
}

const searchableValues = (result: SearchResult) =>
  result.kind === "project"
    ? [result.name, result.slug]
    : result.kind === "issue"
      ? [result.title, String(result.number), `#${result.number}`]
      : [result.title]

const rankTier = (query: string, result: SearchResult) => {
  const values = searchableValues(result).map((value) => value.toLowerCase())
  if (values.some((value) => value === query)) return 0
  if (values.some((value) => value.startsWith(query))) return 1
  if (
    values.some((value) =>
      value.split(/\s+/).some((word) => word.startsWith(query))
    )
  ) {
    return 2
  }
  return 3
}

const isDemoted = (result: SearchResult) =>
  (result.kind === "workspace" && result.status === "archived") ||
  (result.kind === "issue" && result.status === "closed")

export const rankSearchResults = <Result extends RankableSearchResult>(
  query: string,
  results: ReadonlyArray<Result>
) => {
  const normalized = normalizeSearchQuery(query)
  if (!normalized) return []
  return [...results].sort((left, right) => {
    const tier = rankTier(normalized, left) - rankTier(normalized, right)
    if (tier !== 0) return tier
    const demotion = Number(isDemoted(left)) - Number(isDemoted(right))
    if (demotion !== 0) return demotion
    return right.updatedAt - left.updatedAt
  })
}
