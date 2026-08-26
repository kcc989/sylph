import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"

import { OrganizationId, ProjectId, WorkspaceId } from "./ids"
import {
  decodeCreateProjectInput,
  decodeCreateWorkspaceInputPromise,
  decodeInitializeWorkspaceRuntime,
  decodeOpenCodeKeySetupInputPromise,
  decodeOpenCodeSubscriptionStartInputPromise,
  decodeOpenCodeSubscriptionStatusInputPromise,
  decodeSetDefaultOpenCodeConnectionInputPromise,
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

  test("decodes a Workspace for an existing Project", async () => {
    const workspace = await decodeCreateWorkspaceInputPromise({
      projectId: "project-1",
      title: "Add billing",
    })

    expect(workspace.projectId).toBe(ProjectId.make("project-1"))
    expect(workspace.title).toBe("Add billing")
  })

  test("rejects an empty Workspace title", async () => {
    await expect(
      decodeCreateWorkspaceInputPromise({
        projectId: "project-1",
        title: "",
      })
    ).rejects.toBeDefined()
  })

  test("requires an API key for OpenCode setup", async () => {
    await expect(
      decodeOpenCodeKeySetupInputPromise({
        organizationId: "organization-1",
        providerId: "opencode",
        modelId: "gpt-5.2-codex",
        apiKey: "",
      })
    ).rejects.toBeDefined()
  })

  test("scopes OpenCode setup to an Organization", async () => {
    const setup = await decodeOpenCodeKeySetupInputPromise({
      organizationId: "organization-1",
      providerId: "opencode",
      modelId: "nemotron-3.5-lightning-free",
      apiKey: "secret",
    })

    expect(setup.organizationId).toBe(OrganizationId.make("organization-1"))
  })

  test("scopes a default Provider connection to an Organization", async () => {
    const input = await decodeSetDefaultOpenCodeConnectionInputPromise({
      organizationId: "organization-1",
      providerId: "openai",
    })

    expect(input.organizationId).toBe(OrganizationId.make("organization-1"))
    expect(input.providerId).toBe("openai")
  })

  test("accepts the default Codex subscription model", async () => {
    const start = await decodeOpenCodeSubscriptionStartInputPromise({
      organizationId: "organization-1",
      modelId: "gpt-5.6-sol",
    })

    expect(start.modelId).toBe("gpt-5.6-sol")
  })

  test("decodes a Codex subscription status request", async () => {
    const status = await decodeOpenCodeSubscriptionStatusInputPromise({
      organizationId: "organization-1",
      attemptId: "attempt-1",
      modelId: "gpt-5.6-terra",
    })

    expect(status.attemptId).toBe("attempt-1")
    expect(status.modelId).toBe("gpt-5.6-terra")
  })

  test("rejects a model outside the Codex subscription catalog", async () => {
    await expect(
      decodeOpenCodeSubscriptionStartInputPromise({
        organizationId: "organization-1",
        modelId: "gpt-5.5",
      })
    ).rejects.toBeDefined()
  })

  test("decodes an OAuth credential for Workspace initialization", async () => {
    const runtime = await decodeInitializeWorkspaceRuntime({
      organizationId: "organization-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      projectName: "Weather desk",
      repositoryName: "weather-desk-workspace",
      repositoryRemote: "https://repositories.example/weather-desk-workspace",
      providerId: "openai",
      modelId: "gpt-5.6-sol",
      credential: {
        type: "oauth",
        methodID: "chatgpt-headless",
        refresh: "refresh-token",
        access: "access-token",
        expires: 1_800_000_000_000,
      },
    })

    expect(runtime.credential.type).toBe("oauth")
  })
})
