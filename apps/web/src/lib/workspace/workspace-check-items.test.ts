import { describe, expect, test } from "bun:test"

import { workspaceCheckItems } from "./workspace-check-items"

const actions = {
  automaticRepairsUsed: 0,
  limits: {
    maxQueuedMessages: 5,
    maxTurnDurationMs: 900_000,
    maxCheckAttempts: 3,
    maxRepairAttempts: 2,
    maxAutomaticRepairs: 1,
  },
  onRepair: () => undefined,
  onRetry: () => undefined,
  onUpdateProject: () => undefined,
  pending: false,
  projectChanged: true,
  workingChanges: 0,
}

describe("Workspace check items", () => {
  test("shows an actionable Project update before Check stages", () => {
    const items = workspaceCheckItems(undefined, undefined, actions)

    expect(items[0]?.name).toBe("Project Repository")
    expect(items[0]?.action?.label).toBe("Update")
  })
})
