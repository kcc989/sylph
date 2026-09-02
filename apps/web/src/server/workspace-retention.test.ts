import { describe, expect, test } from "bun:test"

import {
  forkRetentionExpired,
  workspaceForkRetention,
  workspaceRetentionInstanceId,
} from "./workspace-fork-retention"

const input = {
  workspaceId: "workspace-1",
  workspaceRepositoryName: "project-workspace1",
  archivedAt: 1_700_000_000,
}

describe("Workspace fork retention", () => {
  test("retains forks for seven days unless configured", () => {
    expect(workspaceForkRetention()).toBe("7 days")
    expect(workspaceForkRetention("60")).toBe(60)
    expect(() => workspaceForkRetention("soon")).toThrow(
      "Workspace fork retention seconds must be a non-negative number"
    )
  })

  test("derives one Workflow instance per archive event", () => {
    expect(workspaceRetentionInstanceId(input)).toBe(
      "retention-workspace-1-1700000000"
    )
  })

  test("deletes only forks that stayed archived since the same archive event", () => {
    expect(
      forkRetentionExpired(input, {
        status: "archived",
        archivedAt: input.archivedAt,
        forkDeletedAt: null,
      })
    ).toBeTrue()
    expect(
      forkRetentionExpired(input, {
        status: "ready",
        archivedAt: input.archivedAt,
        forkDeletedAt: null,
      })
    ).toBeFalse()
    expect(
      forkRetentionExpired(input, {
        status: "archived",
        archivedAt: input.archivedAt + 5,
        forkDeletedAt: null,
      })
    ).toBeFalse()
    expect(
      forkRetentionExpired(input, {
        status: "archived",
        archivedAt: input.archivedAt,
        forkDeletedAt: 1_700_000_500,
      })
    ).toBeFalse()
    expect(forkRetentionExpired(input, null)).toBeFalse()
  })
})
