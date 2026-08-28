import { describe, expect, test } from "bun:test"

import {
  createWorkspacePermissionBridge,
  requireWorkspaceMutationPermission,
  selectWorkspaceVcs,
  type WorkspacePermissionEvaluation,
  workspaceDeleteToolOptions,
  workspaceMutationPermissions,
  workspaceToolOptions,
  workspaceWriteToolOptions,
} from "./workspace-plugin"

describe("Workspace plugin", () => {
  test("tolerates a Workerd VCS draft without a default selector", () => {
    expect(selectWorkspaceVcs({})).toBeUndefined()
  })

  test("selects the Sylph VCS when the runtime exposes a selector", () => {
    let selection = ""

    selectWorkspaceVcs({
      default: { set: (value) => (selection = value) },
    })

    expect(selection).toBe("sylph")
  })

  test("registers workspace filesystem tools for direct model calls", () => {
    expect(workspaceToolOptions).toEqual({ codemode: false })
    expect(workspaceWriteToolOptions).toEqual({
      codemode: false,
      permission: "workspace_write_file",
    })
    expect(workspaceDeleteToolOptions).toEqual({
      codemode: false,
      permission: "workspace_delete_file",
    })
    expect(workspaceMutationPermissions).toEqual([
      {
        action: "workspace_write_file",
        resource: "*",
        effect: "ask",
      },
      {
        action: "workspace_delete_file",
        resource: "*",
        effect: "ask",
      },
    ])
  })

  test("asks before mutating the durable Workspace", () => {
    const write: WorkspacePermissionEvaluation = {
      action: "workspace_write_file",
      effect: "allow",
    }
    const read: WorkspacePermissionEvaluation = {
      action: "workspace_read_file",
      effect: "allow",
    }

    requireWorkspaceMutationPermission(write)
    requireWorkspaceMutationPermission(read)

    expect(write).toEqual({
      action: "workspace_write_file",
      effect: "ask",
      message: "Allow the assistant to change this Workspace?",
    })
    expect(read).toEqual({
      action: "workspace_read_file",
      effect: "allow",
    })
  })

  test("waits for the OpenCode permission decision", async () => {
    const bridge = createWorkspacePermissionBridge()
    const requests: string[] = []
    bridge.connect(async (request) => {
      requests.push(request.path)
      return { id: "permission-1", effect: "allow" }
    })

    await bridge.request({
      sessionID: "session-1",
      agent: "build",
      messageID: "message-1",
      toolCallID: "tool-1",
      action: "workspace_write_file",
      path: "APPROVAL_PROOF.md",
    })

    expect(requests).toEqual(["APPROVAL_PROOF.md"])
  })

  test("waits while OpenCode asks and resumes after approval", async () => {
    const bridge = createWorkspacePermissionBridge()
    bridge.connect(async () => ({ id: "permission-1", effect: "ask" }))
    let settled = false
    const request = bridge
      .request({
        sessionID: "session-1",
        agent: "build",
        messageID: "message-1",
        toolCallID: "tool-1",
        action: "workspace_write_file",
        path: "README.md",
      })
      .then(() => {
        settled = true
      })

    await Promise.resolve()
    expect(settled).toBeFalse()

    bridge.reply("permission-1", "once")
    await request

    expect(settled).toBeTrue()
  })

  test("stops a mutation rejected through OpenCode", async () => {
    const bridge = createWorkspacePermissionBridge()
    bridge.connect(async () => ({ id: "permission-1", effect: "ask" }))
    const request = bridge.request({
      sessionID: "session-1",
      agent: "build",
      messageID: "message-1",
      toolCallID: "tool-1",
      action: "workspace_delete_file",
      path: "README.md",
    })

    await Promise.resolve()
    bridge.reply("permission-1", "reject")

    await expect(request).rejects.toMatchObject({
      message: "Permission denied for workspace_delete_file",
    })
  })
})
