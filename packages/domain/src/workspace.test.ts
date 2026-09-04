import { describe, expect, test } from "bun:test"
import { Effect, Exit, Schema } from "effect"

import { OrganizationId, ProjectId, WorkspaceId } from "./ids"
import { CreateProjectInput } from "./project"
import {
  CreateWorkspaceInput,
  RestartWorkspaceInput,
  WorkspaceSummary,
} from "./workspace"
import {
  DisconnectOpenCodeConnectionInput,
  OpenCodeKeySetupInput,
  OpenCodeSubscriptionStartInput,
  OpenCodeSubscriptionStatusInput,
  SetDefaultModelInput,
} from "./provider-connection"
import {
  InitializeWorkspaceRuntime,
  WorkspacePermissionReplyInput,
  WorkspaceRuntimeEvent,
  WorkspaceRuntimeHealth,
  WorkspaceSocketClientFrame,
  WorkspaceSocketServerFrame,
} from "./conversation"
import { InstallationClaimInput } from "./installation"
import {
  WorkspaceEditFileInput,
  WorkspaceWriteFileInput,
} from "./workspace-files"
import {
  WorkspaceCheckpointInput,
  WorkspaceVersionControl,
} from "./version-control"

const decodeCreateProjectInput = Schema.decodeUnknownEffect(CreateProjectInput)
const decodeCreateWorkspaceInputPromise =
  Schema.decodeUnknownPromise(CreateWorkspaceInput)
const decodeDisconnectOpenCodeConnectionInputPromise =
  Schema.decodeUnknownPromise(DisconnectOpenCodeConnectionInput)
const decodeInitializeWorkspaceRuntime = Schema.decodeUnknownPromise(
  InitializeWorkspaceRuntime
)
const decodeInstallationClaimInputPromise = Schema.decodeUnknownPromise(
  InstallationClaimInput
)
const decodeOpenCodeKeySetupInputPromise = Schema.decodeUnknownPromise(
  OpenCodeKeySetupInput
)
const decodeOpenCodeSubscriptionStartInputPromise = Schema.decodeUnknownPromise(
  OpenCodeSubscriptionStartInput
)
const decodeOpenCodeSubscriptionStatusInputPromise =
  Schema.decodeUnknownPromise(OpenCodeSubscriptionStatusInput)
const decodeRestartWorkspaceInputPromise = Schema.decodeUnknownPromise(
  RestartWorkspaceInput
)
const decodeSetDefaultModelInputPromise =
  Schema.decodeUnknownPromise(SetDefaultModelInput)
const decodeWorkspaceCheckpointInputPromise = Schema.decodeUnknownPromise(
  WorkspaceCheckpointInput
)
const decodeWorkspacePermissionReplyInputPromise = Schema.decodeUnknownPromise(
  WorkspacePermissionReplyInput
)
const decodeWorkspaceRuntimeEventPromise = Schema.decodeUnknownPromise(
  WorkspaceRuntimeEvent
)
const decodeWorkspaceRuntimeHealth = Schema.decodeUnknownPromise(
  WorkspaceRuntimeHealth
)
const decodeWorkspaceSocketClientFrame = Schema.decodeUnknownPromise(
  WorkspaceSocketClientFrame
)
const decodeWorkspaceSocketServerFrame = Schema.decodeUnknownPromise(
  WorkspaceSocketServerFrame
)
const decodeWorkspaceSummary = Schema.decodeUnknownEffect(WorkspaceSummary)
const decodeWorkspaceVersionControl = Schema.decodeUnknownPromise(
  WorkspaceVersionControl
)
const decodeWorkspaceWriteFile = Schema.decodeUnknownPromise(
  WorkspaceWriteFileInput
)

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

  test("decodes a Project forked from a template", async () => {
    const project = await Effect.runPromise(
      decodeCreateProjectInput({
        organizationId: "organization-1",
        name: "Weather desk",
        source: { kind: "template", template: "cloudflare-tanstack" },
      })
    )

    expect(project.name).toBe("Weather desk")
    expect(project.source).toEqual({
      kind: "template",
      template: "cloudflare-tanstack",
    })
  })

  test("decodes a Project imported from a GitHub branch", async () => {
    const project = await Effect.runPromise(
      decodeCreateProjectInput({
        organizationId: "organization-1",
        name: "Sylph",
        source: {
          kind: "github",
          url: "https://github.com/kcc989/Sylph",
          branch: "main",
          mode: "connected",
        },
      })
    )

    expect(project.source.kind).toBe("github")
    if (project.source.kind !== "github") throw new Error("Expected GitHub")
    expect(project.source.url).toBe("https://github.com/kcc989/Sylph")
    expect(project.source.branch).toBe("main")
    expect(project.source.mode).toBe("connected")
  })

  test("decodes an empty Project source", async () => {
    const project = await Effect.runPromise(
      decodeCreateProjectInput({
        organizationId: "organization-1",
        name: "Scratch",
        source: { kind: "empty" },
      })
    )

    expect(project.source).toEqual({ kind: "empty" })
  })

  test("rejects a Project without a source", async () => {
    const exit = await Effect.runPromiseExit(
      decodeCreateProjectInput({
        organizationId: "organization-1",
        name: "Weather desk",
      })
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("rejects an empty workspace file path", async () => {
    await expect(
      decodeWorkspaceWriteFile({ path: "", content: "hello" })
    ).rejects.toBeDefined()
  })

  test("requires nonempty edit context and permits deleting matched text", () => {
    const decode = Schema.decodeUnknownSync(WorkspaceEditFileInput)
    expect(() =>
      decode({ path: "bun.lock", oldText: "", newText: "new" })
    ).toThrow()
    expect(
      decode({ path: "bun.lock", oldText: "old", newText: "" }).newText
    ).toBe("")
  })

  test("decodes a Workspace for an existing Project", async () => {
    const workspace = await decodeCreateWorkspaceInputPromise({
      projectId: "project-1",
    })

    expect(workspace.projectId).toBe(ProjectId.make("project-1"))
  })

  test("rejects an empty Project id when creating a Workspace", async () => {
    await expect(
      decodeCreateWorkspaceInputPromise({
        projectId: "",
      })
    ).rejects.toBeDefined()
  })

  test("restarts a Workspace with a selected model", async () => {
    const restart = await decodeRestartWorkspaceInputPromise({
      workspaceId: "workspace-1",
      model: { providerId: "openrouter", modelId: "openrouter/auto" },
    })

    expect(restart.model?.providerId).toBe("openrouter")
    expect(restart.model?.modelId).toBe("openrouter/auto")
  })

  test("decodes a Workspace permission reply", async () => {
    const reply = await decodeWorkspacePermissionReplyInputPromise({
      workspaceId: "workspace-1",
      requestId: "permission-1",
      reply: "once",
    })

    expect(reply.requestId).toBe("permission-1")
    expect(reply.reply).toBe("once")
  })

  test("preserves an OpenCode runtime event envelope", async () => {
    const event = await decodeWorkspaceRuntimeEventPromise({
      id: "event-1",
      created: 1,
      type: "session.text.delta",
      data: { sessionID: "session-1", delta: "hello" },
      durable: { seq: 2 },
    })

    expect(event.type).toBe("session.text.delta")
    expect(event.data).toEqual({ sessionID: "session-1", delta: "hello" })
    expect(event.durable).toEqual({ seq: 2 })
  })

  test("decodes Workspace socket frames at the transport boundary", async () => {
    const hello = await decodeWorkspaceSocketClientFrame({
      type: "hello",
      sessionId: "session-1",
      cursor: 12,
    })
    const event = await decodeWorkspaceSocketServerFrame({
      type: "event",
      event: {
        id: "event-1",
        created: 1,
        type: "session.idle",
        data: { sessionID: "session-1" },
        durable: { aggregateID: "session-1", seq: 13, version: 1 },
      },
    })

    expect(hello.type).toBe("hello")
    expect(event.type).toBe("event")
  })

  test("preserves pending permission requests in runtime health", async () => {
    const health = await decodeWorkspaceRuntimeHealth({
      workspaceId: "workspace-1",
      sessionId: "session-1",
      eventCursor: 2,
      status: "running",
      model: "openrouter/model-1",
      files: [],
      messages: [],
      queuedMessages: [],
      questions: [],
      lastTurnOutcome: null,
      activeTurnStartedAt: 1,
      limits: {
        maxTurnDurationMs: 900_000,
        maxQueuedMessages: 5,
        maxCheckAttempts: 3,
        maxRepairAttempts: 2,
        maxAutomaticRepairs: 3,
      },
      automaticRepairsUsed: 0,
      archivedAt: null,
      permissions: [
        {
          id: "permission-1",
          sessionID: "session-1",
          action: "workspace_write_file",
          resources: ["APPROVAL_PROOF.md"],
        },
      ],
      opencode: { healthy: true },
    })

    expect(health.permissions[0]?.action).toBe("workspace_write_file")
    expect(health.eventCursor).toBe(2)
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

  test("preserves Cloudflare Workers AI connection configuration", async () => {
    const setup = await decodeOpenCodeKeySetupInputPromise({
      organizationId: "organization-1",
      scope: "organization",
      providerId: "cloudflare-workers-ai",
      apiKey: "secret",
      configuration: { accountId: "account-1" },
    })

    expect(setup.providerId).toBe("cloudflare-workers-ai")
    expect(setup.configuration).toEqual({ accountId: "account-1" })
  })

  test("rejects providers outside the supported key integrations", async () => {
    await expect(
      decodeOpenCodeKeySetupInputPromise({
        organizationId: "organization-1",
        scope: "user",
        providerId: "unsupported",
        apiKey: "secret",
      })
    ).rejects.toBeDefined()
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

  test("scopes a provider disconnect to the current user", async () => {
    const input = await decodeDisconnectOpenCodeConnectionInputPromise({
      organizationId: "organization-1",
      scope: "user",
      providerId: "openai",
    })

    expect(input.organizationId).toBe(OrganizationId.make("organization-1"))
    expect(input.scope).toBe("user")
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
