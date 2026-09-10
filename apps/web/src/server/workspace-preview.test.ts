import { expect, test } from "bun:test"
import { WorkspaceCheckRun } from "@workspace/domain"
import { newCheckRun } from "./workspace-checks"
import { previewForRequest } from "./workspace-preview"

const commit = "a".repeat(40)
const preview = (
  id: string,
  status: WorkspaceCheckRun["status"],
  captureEvidence: boolean
) =>
  new WorkspaceCheckRun({
    ...newCheckRun({
      id,
      workspaceId: "workspace-1",
      checkpointId: "checkpoint-1",
      commit,
      kind: "preview",
      attempt: 1,
      createdAt: 1,
      captureEvidence,
    }),
    status,
    previewUrl: status === "passed" ? "https://preview.example.com" : null,
  })

test("reuses an evidenced Preview when the agent does not request extra evidence", () => {
  const current = preview("captured", "passed", true)
  expect(previewForRequest([current], commit, false)).toEqual({
    current,
    compatible: true,
    reusable: true,
  })
})

test("does not return an older success over the current failed attempt", () => {
  const current = preview("failed", "failed", false)
  expect(
    previewForRequest([current, preview("older", "passed", true)], commit, true)
  ).toEqual({ current, compatible: false, reusable: false })
})

test("retries the current compatible failure instead of an older run", () => {
  const current = preview("failed", "failed", true)
  expect(previewForRequest([current], commit, true)).toEqual({
    current,
    compatible: true,
    reusable: false,
  })
})

test("requests a new capture when the current Preview has no evidence", () => {
  expect(
    previewForRequest([preview("plain", "passed", false)], commit, true)
      .reusable
  ).toBeFalse()
})

test("reuses pending compatible runs and excludes other checkpoints", () => {
  expect(
    previewForRequest([preview("pending", "running", true)], commit, true)
      .reusable
  ).toBeTrue()
  expect(
    previewForRequest([preview("old", "passed", true)], "b".repeat(40), false)
      .current
  ).toBeUndefined()
})
