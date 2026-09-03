import { describe, expect, test } from "bun:test"
import {
  IssueId,
  ProjectId,
  WorkspaceId,
  normalizeSearchQuery,
  rankSearchResults,
  type RankableSearchResult,
} from "@workspace/domain"

const archivedWorkspace: RankableSearchResult = {
  kind: "workspace",
  id: WorkspaceId.make("workspace-archived"),
  projectId: ProjectId.make("project-1"),
  projectSlug: "sylph",
  projectName: "Sylph",
  title: "Some search palette",
  status: "archived",
  updatedAt: 500,
}

const openIssue: RankableSearchResult = {
  kind: "issue",
  id: IssueId.make("issue-1"),
  projectId: ProjectId.make("project-1"),
  projectSlug: "sylph",
  projectName: "Sylph",
  number: 12,
  title: "Search command palette",
  status: "open",
  updatedAt: 100,
}

const exactProject: RankableSearchResult = {
  kind: "project",
  id: ProjectId.make("project-2"),
  name: "Search",
  slug: "search",
  updatedAt: 50,
}

const readyWorkspace: RankableSearchResult = {
  kind: "workspace",
  id: WorkspaceId.make("workspace-new"),
  projectId: ProjectId.make("project-1"),
  projectSlug: "sylph",
  projectName: "Sylph",
  title: "Global search",
  status: "ready",
  updatedAt: 200,
}

const results: RankableSearchResult[] = [
  archivedWorkspace,
  openIssue,
  exactProject,
  readyWorkspace,
]

describe("normalizeSearchQuery", () => {
  test("normalizes whitespace and case", () => {
    expect(normalizeSearchQuery("  Global   SEARCH ")).toBe("global search")
  })

  test("returns null for an empty query", () => {
    expect(normalizeSearchQuery(" \n ")).toBeNull()
  })
})

describe("rankSearchResults", () => {
  test("orders exact, title prefix, word prefix, and substring matches", () => {
    expect(
      rankSearchResults("search", results).map((result) => String(result.id))
    ).toEqual(["project-2", "issue-1", "workspace-new", "workspace-archived"])
  })

  test("demotes archived and closed results within a tier", () => {
    const ranked = rankSearchResults("search", [
      archivedWorkspace,
      {
        ...archivedWorkspace,
        id: WorkspaceId.make("workspace-ready"),
        status: "ready",
        updatedAt: 1,
      },
    ])
    expect(ranked.map((result) => String(result.id))).toEqual([
      "workspace-ready",
      "workspace-archived",
    ])
  })

  test("uses newest updated time as the final tie breaker", () => {
    const ranked = rankSearchResults("search", [
      openIssue,
      {
        ...openIssue,
        id: IssueId.make("issue-2"),
        updatedAt: 600,
      },
    ])
    expect(ranked.map((result) => String(result.id))).toEqual([
      "issue-2",
      "issue-1",
    ])
  })
})
