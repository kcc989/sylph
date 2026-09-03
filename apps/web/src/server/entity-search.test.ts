import { describe, expect, test } from "bun:test"
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core"

import {
  buildEntitySearchPredicates,
  buildEntityMembershipPredicate,
  escapeLikeValue,
  issueNumberFromQuery,
} from "@/server/entity-search"

const dialect = new SQLiteSyncDialect()

describe("entity search predicates", () => {
  test("escapes LIKE wildcard and escape characters", () => {
    expect(escapeLikeValue("50%_done\\later")).toBe("50\\%\\_done\\\\later")
  })

  test("short-circuits an empty normalized query", () => {
    expect(buildEntitySearchPredicates("  \n ")).toBeNull()
  })

  test("matches Project names, slugs, and Workspace titles with ESCAPE", () => {
    const predicates = buildEntitySearchPredicates("Search")
    expect(predicates).not.toBeNull()
    if (!predicates) return
    const project = dialect.sqlToQuery(predicates.project)
    const workspace = dialect.sqlToQuery(predicates.workspace)
    expect(project.sql).toContain('lower("project"."name") LIKE ? ESCAPE')
    expect(project.sql).toContain('lower("project"."slug") LIKE ? ESCAPE')
    expect(project.params).toEqual(["%search%", "%search%"])
    expect(workspace.sql).toContain('lower("workspace"."title") LIKE ? ESCAPE')
  })

  test("adds an exact Issue number predicate for numeric queries", () => {
    expect(issueNumberFromQuery("#42")).toBe(42)
    expect(issueNumberFromQuery("issue 42")).toBeNull()
    const predicates = buildEntitySearchPredicates("#42")
    expect(predicates).not.toBeNull()
    if (!predicates) return
    const issue = dialect.sqlToQuery(predicates.issue)
    expect(issue.sql).toContain('"issue"."number" = ?')
    expect(issue.params).toContain(42)
  })

  test("scopes entities to a user's Organization memberships", () => {
    const membership = dialect.sqlToQuery(
      buildEntityMembershipPredicate("user-1")
    )
    expect(membership.sql).toContain(
      '"member"."organization_id" = "project"."organization_id"'
    )
    expect(membership.sql).toContain('"member"."user_id" = ?')
    expect(membership.params).toEqual(["user-1"])
  })
})
