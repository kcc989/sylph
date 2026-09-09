import { describe, expect, test } from "bun:test"

import {
  selectWorkspaceVcs,
  workspaceMutationPermissions,
  workspaceSystemPrompt,
  workspaceToolOptions,
} from "./workspace-plugin"

describe("Workspace plugin", () => {
  test("uses native commands and keeps product delivery tools", () => {
    expect(workspaceSystemPrompt).toContain("shell tools")
    expect(workspaceSystemPrompt).toContain("bun install")
    expect(workspaceSystemPrompt).not.toContain(
      "workspace_install_dependencies"
    )
    expect(workspaceSystemPrompt).toContain("workspace_browser")
    expect(workspaceSystemPrompt).toContain("workspace_checkpoint")
    expect(workspaceSystemPrompt).toContain("workspace_preview")
    expect(workspaceSystemPrompt).toContain("opt-in")
    expect(workspaceSystemPrompt).toContain(
      "Set autoRepair only when the User requested automatic repair"
    )
    expect(workspaceSystemPrompt).not.toContain("workspace_check_status")
    expect(workspaceSystemPrompt).not.toContain(
      "browser control is unavailable"
    )
  })

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

  test("auto-approves native workspace edits and shell commands", () => {
    expect(workspaceToolOptions).toEqual({ codemode: false })
    expect(workspaceMutationPermissions).toEqual([
      {
        action: "edit",
        resource: "*",
        effect: "allow",
      },
      {
        action: "shell",
        resource: "*",
        effect: "allow",
      },
    ])
  })
})
