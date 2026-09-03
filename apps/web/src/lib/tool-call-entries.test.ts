import { describe, expect, test } from "bun:test"
import { WorkspaceMessageToolPart } from "@workspace/domain"

import { toolCallEntry } from "./tool-call-entries"

const part = (name: string, output: string) =>
  new WorkspaceMessageToolPart({
    type: "tool",
    id: "tool-1",
    name,
    status: "completed",
    input: {},
    output,
    outputTruncated: false,
    files: [],
    error: null,
  })

const checkRun = {
  id: "check-1",
  workspaceId: "workspace-1",
  checkpointId: null,
  commit: "a".repeat(40),
  kind: "checkpoint",
  status: "passed",
  attempt: 2,
  repairOnFailure: false,
  repairStatus: "disabled",
  previewUrl: null,
  stages: [],
  diagnostics: [],
  evidence: [],
  createdAt: 1,
  updatedAt: 2,
}

describe("toolCallEntry", () => {
  test("decodes Workspace diffs", () => {
    const entry = toolCallEntry(
      part(
        "workspace_diff",
        JSON.stringify({
          scope: "working",
          baseCommit: "a".repeat(40),
          forkHead: "b".repeat(40),
          files: [
            {
              file: "src/app.tsx",
              status: "modified",
              additions: 4,
              deletions: 1,
              patch: "diff --git a/src/app.tsx b/src/app.tsx",
            },
          ],
          truncated: false,
        })
      )
    )

    expect(entry.detail).toEqual({
      kind: "diff",
      files: [
        {
          file: "src/app.tsx",
          status: "modified",
          additions: 4,
          deletions: 1,
          patch: "diff --git a/src/app.tsx b/src/app.tsx",
        },
      ],
    })
  })

  test("decodes browser metadata and markdown", () => {
    const header = JSON.stringify({
      url: "https://preview.example.com/login",
      checkId: "check-1",
      evidence: [
        {
          id: "evidence-1",
          kind: "screenshot",
          label: "Login page",
          url: "/api/evidence/evidence-1",
          createdAt: 1,
        },
      ],
      accessibility: "document Login",
    })
    const entry = toolCallEntry(
      part("workspace_browser", `${header}\n# Login\n\nWelcome back.`)
    )

    expect(entry.detail).toEqual({
      kind: "browser",
      url: "https://preview.example.com/login",
      evidence: [
        {
          id: "evidence-1",
          kind: "screenshot",
          label: "Login page",
          url: "/api/evidence/evidence-1",
        },
      ],
      markdown: "# Login\n\nWelcome back.",
      accessibility: "document Login",
    })
  })

  test("decodes one check run or a list", () => {
    expect(
      toolCallEntry(part("workspace_run_checks", JSON.stringify(checkRun)))
        .detail
    ).toEqual({
      kind: "checks",
      runs: [
        {
          id: "check-1",
          status: "passed",
          label: "Checkpoint check · attempt 2",
        },
      ],
    })
    expect(
      toolCallEntry(part("workspace_check_status", JSON.stringify([checkRun])))
        .detail
    ).toMatchObject({ kind: "checks", runs: [{ id: "check-1" }] })
  })

  test("falls back when structured output is malformed", () => {
    expect(toolCallEntry(part("workspace_diff", "not json")).detail).toBe(
      undefined
    )
    expect(
      toolCallEntry(part("workspace_browser", '{"url":'))
    ).not.toHaveProperty("detail")
  })
})
