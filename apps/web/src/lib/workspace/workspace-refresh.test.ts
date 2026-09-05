import { expect, test } from "bun:test"
import {
  createWorkspaceRefreshQueue,
  workspaceRefreshScope,
  type WorkspaceRefreshScope,
} from "./workspace-refresh"

test("requests only check or conversation data for narrow events", () => {
  expect(workspaceRefreshScope("workspace.check.updated")).toBe("checks")
  expect(workspaceRefreshScope("session.execution.started")).toBe("runtime")
  expect(workspaceRefreshScope("form.created")).toBe("runtime")
  expect(workspaceRefreshScope("session.inbox.enqueued")).toBe("runtime")
  expect(workspaceRefreshScope("session.tool.success")).toBe("workspace")
  expect(workspaceRefreshScope("workspace.event.truncated")).toBe("workspace")
})

test("coalesces bursts and serializes refreshes without losing the last update", async () => {
  const scopes: WorkspaceRefreshScope[] = []
  let release = () => {}
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const refresh = createWorkspaceRefreshQueue(async (scope) => {
    scopes.push(scope)
    if (scopes.length === 1) await blocked
  })
  const first = refresh("checks")
  await Promise.resolve()
  refresh("runtime")
  refresh("checks")
  refresh("runtime")
  expect(scopes).toEqual(["checks"])
  release()
  await first
  expect(scopes).toEqual(["checks", "workspace"])
  await refresh("runtime")
  expect(scopes).toEqual(["checks", "workspace", "runtime"])
})

test("a failed refresh can be retried", async () => {
  let calls = 0
  const refresh = createWorkspaceRefreshQueue(async () => {
    calls += 1
    if (calls === 1) throw new Error("offline")
  })
  await expect(refresh("workspace")).rejects.toThrow("offline")
  await refresh("workspace")
  expect(calls).toBe(2)
})
