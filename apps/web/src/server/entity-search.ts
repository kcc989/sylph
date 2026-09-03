import { schema } from "@workspace/db"
import { normalizeSearchQuery } from "@workspace/domain"
import { and, eq, or, sql, type SQL } from "drizzle-orm"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"

export const escapeLikeValue = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")

export const issueNumberFromQuery = (query: string) => {
  const match = /^#?(\d+)$/.exec(query)
  return match ? Number(match[1]) : null
}

export const buildEntityMembershipPredicate = (userId: string) => {
  const predicate = and(
    eq(schema.member.organizationId, schema.project.organizationId),
    eq(schema.member.userId, userId)
  )
  if (!predicate) throw new Error("Entity membership predicate is empty")
  return predicate
}

const contains = (column: AnySQLiteColumn, pattern: string) =>
  sql`lower(${column}) LIKE ${pattern} ESCAPE '\\'`

export const buildEntitySearchPredicates = (
  rawQuery: string
): {
  project: SQL
  workspace: SQL
  issue: SQL
} | null => {
  const query = normalizeSearchQuery(rawQuery)
  if (!query) return null
  const pattern = `%${escapeLikeValue(query)}%`
  const issueNumber = issueNumberFromQuery(query)
  const project = or(
    contains(schema.project.name, pattern),
    contains(schema.project.slug, pattern)
  )
  const issue = or(
    contains(schema.issue.title, pattern),
    ...(issueNumber === null ? [] : [eq(schema.issue.number, issueNumber)])
  )
  if (!project || !issue) return null
  return {
    project,
    workspace: contains(schema.workspace.title, pattern),
    issue,
  }
}
