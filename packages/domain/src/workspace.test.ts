import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"

import { OrganizationId, ProjectId, WorkspaceId } from "./ids"
import {
  decodeCreateProjectInput,
  decodeCreateWorkspaceInputPromise,
  decodeInitializeWorkspaceRuntime,
  decodeInstallationClaimInputPromise,
  decodeOpenCodeKeySetupInputPromise,
  decodeOpenCodeSubscriptionStartInputPromise,
  decodeOpenCodeSubscriptionStatusInputPromise,
  decodeSetDefaultModelInputPromise,
  decodeWorkspaceSummary,
  decodeWorkspaceWriteFile,
} from "./workspace"
import {
  decodeWorkspaceCheckpointInputPromise,
  decodeWorkspaceVersionControl,
} from "./version-control"

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
  test("requires an explicit email confirmation for Installation claims", async () => {
    const claim = await decodeInstallationClaimInputPromise({
      claimSecret: "claim-secret",
      confirmedEmail: "operator@example.com",
      organizationName: "Acme Labs",
    })

    expect(claim.confirmedEmail).toBe("operator@example.com")
  })

  test("rejects an empty Installation claim email confirmation", async () => {
    await expect(
      decodeInstallationClaimInputPromise({
        claimSecret: "claim-secret",
        confirmedEmail: "",
        organizationName: "Acme Labs",
      })
    ).rejects.toBeDefined()
  })

  test("decodes a project that belongs to an organization", async () => {
    const project = await Effect.runPromise(
      decodeCreateProjectInput({
        organizationId: "organization-1",
        scope: "organization",
        name: "Weather desk",
      })
    )

    expect(project.name).toBe("Weather desk")
  })

  test("decodes a Project imported from a GitHub branch", async () => {
    const project = await Effect.runPromise(
      decodeCreateProjectInput({
        organizationId: "organization-1",
        name: "Sylph",
        sourceRepositoryUrl: "https://github.com/kcc989/Sylph",
        sourceBranch: "main",
      })
    )

    expect(project.sourceRepositoryUrl).toBe("https://github.com/kcc989/Sylph")
    expect(project.sourceBranch).toBe("main")
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
        scope: "user",
        providerId: "opencode",
        apiKey: "",
      })
    ).rejects.toBeDefined()
  })

  test("scopes OpenCode setup to an Organization", async () => {
    const setup = await decodeOpenCodeKeySetupInputPromise({
      organizationId: "organization-1",
      scope: "user",
      providerId: "opencode",
      apiKey: "secret",
    })

    expect(setup.organizationId).toBe(OrganizationId.make("organization-1"))
    expect(setup.scope).toBe("user")
  })

  test("scopes a default model to an Organization", async () => {
    const input = await decodeSetDefaultModelInputPromise({
      organizationId: "organization-1",
      scope: "organization",
      providerId: "openai",
      modelId: "gpt-5.6-sol",
    })

    expect(input.organizationId).toBe(OrganizationId.make("organization-1"))
    expect(input.providerId).toBe("openai")
  })

  test("starts a Codex subscription connection without choosing a model", async () => {
    const start = await decodeOpenCodeSubscriptionStartInputPromise({
      organizationId: "organization-1",
      scope: "user",
    })

    expect(start.scope).toBe("user")
  })

  test("decodes a Codex subscription status request", async () => {
    const status = await decodeOpenCodeSubscriptionStatusInputPromise({
      organizationId: "organization-1",
      scope: "user",
      attemptId: "attempt-1",
    })

    expect(status.attemptId).toBe("attempt-1")
  })

  test("decodes an OAuth credential for Workspace initialization", async () => {
    const runtime = await decodeInitializeWorkspaceRuntime({
      organizationId: "organization-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      projectName: "Weather desk",
      repositoryName: "weather-desk-workspace",
      repositoryRemote: "https://repositories.example/weather-desk-workspace",
      projectRepositoryName: "weather-desk",
      projectRepositoryRemote: "https://repositories.example/weather-desk",
      defaultRef: "main",
      baseCommit: "a".repeat(40),
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

describe("Artifact-backed Workspace version control", () => {
  test("requires a valid commit identity in VCS state", async () => {
    await expect(
      decodeWorkspaceVersionControl({
        defaultRef: "main",
        currentRef: "main",
        baseCommit: "not-a-commit",
        forkHead: "a".repeat(40),
        projectHead: "a".repeat(40),
        projectChanged: false,
        syncStatus: "ready",
        mergeStatus: "unreviewed",
        working: [],
        branch: [],
      })
    ).rejects.toBeDefined()
  })

  test("decodes an idempotent Checkpoint request", async () => {
    const input = await decodeWorkspaceCheckpointInputPromise({
      workspaceId: "workspace-1",
      idempotencyKey: "checkpoint-1",
      message: "Save progress",
    })

    expect(input.idempotencyKey).toBe("checkpoint-1")
  })
})
