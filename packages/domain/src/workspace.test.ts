import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"

import { WorkspaceId } from "./ids"
import {
  decodeCreateProjectInput,
  decodeOpenCodeSetupInputPromise,
  decodeWorkspaceSummary,
  decodeWorkspaceWriteFile,
} from "./workspace"

describe("WorkspaceSummary", () => {
  test("decodes a valid workspace summary", async () => {
    const summary = await Effect.runPromise(
      decodeWorkspaceSummary({
        id: "workspace-1",
        projectId: "project-1",
        title: "Set up CI",
        status: "ready",
      })
    )

    expect(summary.id).toBe(WorkspaceId.make("workspace-1"))
    expect(summary.status).toBe("ready")
  })

  test("rejects an empty title", async () => {
    const exit = await Effect.runPromiseExit(
      decodeWorkspaceSummary({
        id: "workspace-1",
        projectId: "project-1",
        title: "",
        status: "ready",
      })
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe("Project and runtime inputs", () => {
  test("decodes a project that belongs to an organization", async () => {
    const project = await Effect.runPromise(
      decodeCreateProjectInput({
        organizationId: "organization-1",
        name: "Weather desk",
      })
    )

    expect(project.name).toBe("Weather desk")
  })

  test("rejects an empty workspace file path", async () => {
    await expect(
      decodeWorkspaceWriteFile({ path: "", content: "hello" })
    ).rejects.toBeDefined()
  })

  test("requires an API key for OpenCode setup", async () => {
    await expect(
      decodeOpenCodeSetupInputPromise({
        providerId: "opencode",
        modelId: "gpt-5.2-codex",
        apiKey: "",
      })
    ).rejects.toBeDefined()
  })
})
