import { describe, expect, test } from "bun:test"
import { GitCommitId, WorkspaceCheckRun, WorkspaceId } from "@workspace/domain"

import {
  bounded,
  browserEvidenceIds,
  browserTargetUrl,
  evidenceUrl,
  previewForBrowser,
  validateBrowserOrigins,
} from "./workspace-browser"

const commitA = GitCommitId.make("a".repeat(40))
const commitB = GitCommitId.make("b".repeat(40))

const run = (input: {
  id: string
  commit: GitCommitId
  previewUrl: string | null
}) =>
  new WorkspaceCheckRun({
    id: input.id,
    workspaceId: WorkspaceId.make("workspace-1"),
    checkpointId: input.id,
    commit: input.commit,
    kind: "checkpoint",
    status: input.previewUrl ? "passed" : "running",
    attempt: 1,
    previewUrl: input.previewUrl,
    stages: [],
    diagnostics: [],
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
  })

describe("Agent browser", () => {
  test("resolves paths against the Preview origin", () => {
    expect(
      browserTargetUrl({
        previewUrl: "https://preview.example.workers.dev/",
        path: "/settings?tab=1",
      })
    ).toBe("https://preview.example.workers.dev/settings?tab=1")
    expect(
      browserTargetUrl({ previewUrl: "https://preview.example.workers.dev" })
    ).toBe("https://preview.example.workers.dev/")
  })

  test("refuses any origin other than the Preview", () => {
    expect(() =>
      browserTargetUrl({
        previewUrl: "https://preview.example.workers.dev",
        url: "https://example.com/",
      })
    ).toThrow("limited to the Preview")
    expect(() =>
      browserTargetUrl({
        previewUrl: "https://preview.example.workers.dev",
        url: "http://preview.example.workers.dev/",
      })
    ).toThrow("limited to the Preview")
  })

  test("requires the current Checkpoint Preview without falling back", () => {
    const current = run({ id: "check-b", commit: commitB, previewUrl: null })
    const previous = run({
      id: "check-a",
      commit: commitA,
      previewUrl: "https://a.example.workers.dev",
    })
    expect(() => previewForBrowser([current, previous], commitB)).toThrow(
      "No Preview exists for the current Checkpoint"
    )
    expect(() => previewForBrowser([current], commitB)).toThrow(
      "No Preview exists for the current Checkpoint"
    )
    expect(previewForBrowser([current, previous], commitA).run).toEqual(
      previous
    )
  })

  test("bounds tool output and names evidence deterministically", () => {
    expect(bounded("abcdef", 3)).toBe("abc\n…[truncated 3 characters]")
    expect(bounded("abc", 3)).toBe("abc")
    expect(browserEvidenceIds({ runId: "check-1", sequence: 7 })).toEqual({
      screenshot: "check-1-agent-screenshot-7",
      accessibility: "check-1-agent-accessibility-7",
    })
    expect(evidenceUrl("workspace 1", "shot/1")).toBe(
      "/api/workspaces/workspace%201/evidence/shot%2F1"
    )
  })

  test("waits for the Check to finish before attaching agent evidence", () => {
    const pending = new WorkspaceCheckRun({
      ...run({
        id: "check-a",
        commit: commitA,
        previewUrl: "https://a.example.workers.dev",
      }),
      status: "running",
    })
    expect(() => previewForBrowser([pending], commitA)).toThrow("still running")
  })
})

test("configured OAuth origins are exact and do not widen other navigation", () => {
  const previewUrl = "https://preview.example.com"
  const allowedOrigins = ["https://accounts.example.com"]
  validateBrowserOrigins(allowedOrigins)
  expect(
    browserTargetUrl({
      previewUrl,
      allowedOrigins,
      url: "https://accounts.example.com/login",
    })
  ).toBe("https://accounts.example.com/login")
  for (const url of [
    "https://accounts.example.com.evil.com/login",
    "http://accounts.example.com",
    "https://user:password@accounts.example.com",
    "https://accounts.example.com:8080",
  ]) {
    expect(() =>
      browserTargetUrl({ previewUrl, allowedOrigins, url })
    ).toThrow()
  }
  for (const origin of [
    "https://*.example.com",
    "https://127.0.0.1",
    "https://localhost",
    "https://test.internal",
    "https://accounts.example.com/path",
    "https://user:password@accounts.example.com",
    "http://accounts.example.com",
  ]) {
    expect(() => validateBrowserOrigins([origin])).toThrow()
  }
})
