import { describe, expect, test } from "bun:test"
import {
  GitCommitId,
  OpenCodeKeySetupInput,
  OrganizationId,
  PreconditionFailed,
  serializeServerFailure,
  WorkspaceCheckpointInput,
  WorkspaceId,
  WorkspaceReadOnly,
  WorkspaceRuntimeFailure,
  WorkspaceTurnCancelInput,
  WorkspaceReadFileInput,
  WorkspaceMessagePageInput,
} from "@workspace/domain"

import {
  makeWorkspaceRuntime,
  type WorkspaceRuntimeStub,
} from "./workspace-runtime-client"

const unreachable = () => Promise.reject(new Error("not expected"))

const stub = (
  overrides: Partial<WorkspaceRuntimeStub>
): WorkspaceRuntimeStub => ({
  connectKey: unreachable,
  startSubscriptionSignIn: unreachable,
  subscriptionSignInStatus: unreachable,
  cancelSubscriptionSignIn: unreachable,
  initialize: unreachable,
  checkpoint: unreachable,
  listChecks: unreachable,
  readFile: unreachable,
  applyCheckUpdate: unreachable,
  archive: unreachable,
  retryCheck: unreachable,
  repairCheck: unreachable,
  updateProject: unreachable,
  rebase: unreachable,
  versionControl: unreachable,
  prompt: unreachable,
  cancelTurn: unreachable,
  reloadSkills: unreachable,
  replyPermission: unreachable,
  disconnectUser: unreachable,
  answerQuestion: unreachable,
  discard: unreachable,
  evict: unreachable,
  snapshot: unreachable,
  listMessages: unreachable,
  fetch: unreachable,
  ...overrides,
})

const workspaceId = WorkspaceId.make("workspace-1")
const malformedChecks = JSON.parse('[{"id":"broken"}]')
const commit = GitCommitId.make("a".repeat(40))

describe("Workspace runtime client", () => {
  test("encodes provider input after a server serialization hop", async () => {
    const received: string[] = []
    const runtime = makeWorkspaceRuntime(
      stub({
        connectKey: async (input) => {
          received.push(`${input.providerId}:${input.apiKey}`)
          return { models: [], recommendedModelId: null }
        },
      })
    )
    const decoded = new OpenCodeKeySetupInput({
      organizationId: OrganizationId.make("organization-1"),
      scope: "organization",
      providerId: "openrouter",
      apiKey: "provider-key",
    })

    await runtime.connectKey({ ...decoded })

    expect(received).toEqual(["openrouter:provider-key"])
  })

  test("encodes inputs for the stub and decodes its results", async () => {
    const received: string[] = []
    const runtime = makeWorkspaceRuntime(
      stub({
        checkpoint: async (input) => {
          received.push(`${input.workspaceId}:${input.idempotencyKey}`)
          return {
            checkpoint: {
              id: "checkpoint-1",
              commit,
              message: input.message,
              createdAt: 5,
            },
            replayed: false,
          }
        },
        versionControl: async () => null,
      })
    )

    const result = await runtime.checkpoint(
      new WorkspaceCheckpointInput({
        workspaceId,
        idempotencyKey: "key",
        message: "Save work",
      })
    )

    expect(received).toEqual(["workspace-1:key"])
    expect(result.checkpoint.commit).toBe(commit)
    expect(result.replayed).toBe(false)
    expect(await runtime.versionControl(true)).toBeNull()
  })

  test("encodes file input and decodes file content", async () => {
    const received: string[] = []
    const runtime = makeWorkspaceRuntime(
      stub({
        readFile: async (input) => {
          received.push(`${input.workspaceId}:${input.path}`)
          return {
            path: input.path,
            size: 12,
            updatedAt: 25,
            encoding: "utf8",
            content: "hello world\n",
          }
        },
      })
    )

    const result = await runtime.readFile(
      new WorkspaceReadFileInput({ workspaceId, path: "src/index.ts" })
    )

    expect(received).toEqual(["workspace-1:src/index.ts"])
    expect(result.path).toBe("src/index.ts")
    expect(result.content).toBe("hello world\n")
  })

  test("reads one conversation page through the runtime boundary", async () => {
    const runtime = makeWorkspaceRuntime(
      stub({
        listMessages: async (input) => {
          expect(input.cursor).toBe("older-page")
          return { messages: [], cursor: null }
        },
      })
    )
    const page = await runtime.listMessages(
      new WorkspaceMessagePageInput({
        workspaceId: WorkspaceId.make("workspace-1"),
        cursor: "older-page",
      })
    )
    expect(page.messages).toEqual([])
    expect(page.cursor).toBeNull()
  })

  test("restores a tagged failure that crossed the hop as a message", async () => {
    const runtime = makeWorkspaceRuntime(
      stub({
        cancelTurn: async () => {
          throw new Error(
            serializeServerFailure(
              new PreconditionFailed({ message: "There is no active Turn" })
            )
          )
        },
        rebase: async () => {
          throw new Error(
            serializeServerFailure(
              new WorkspaceReadOnly({
                message: "Archived Workspaces are read-only",
                status: "archived",
              })
            )
          )
        },
      })
    )

    const cancelled = await runtime
      .cancelTurn(new WorkspaceTurnCancelInput({ workspaceId }))
      .catch((cause) => cause)
    expect(cancelled).toBeInstanceOf(PreconditionFailed)
    expect(cancelled.message).toBe("There is no active Turn")

    const rebased = await runtime.rebase().catch((cause) => cause)
    expect(rebased).toBeInstanceOf(WorkspaceReadOnly)
    expect(rebased.status).toBe("archived")
  })

  test("wraps any other rejection as a runtime failure", async () => {
    const runtime = makeWorkspaceRuntime(
      stub({
        snapshot: async () => {
          throw new Error("Durable Object reset")
        },
        discard: async () => {
          throw "gone"
        },
      })
    )

    const snapshot = await runtime.snapshot().catch((cause) => cause)
    expect(snapshot).toBeInstanceOf(WorkspaceRuntimeFailure)
    expect(snapshot.message).toBe("Durable Object reset")

    const discarded = await runtime.discard().catch((cause) => cause)
    expect(discarded).toBeInstanceOf(WorkspaceRuntimeFailure)
    expect(discarded.message).toBe("Workspace runtime failed")
  })

  test("rejects a malformed stub result instead of passing it through", async () => {
    const runtime = makeWorkspaceRuntime(
      stub({ listChecks: async () => malformedChecks })
    )

    const failure = await runtime.listChecks().catch((cause) => cause)
    expect(failure).toBeInstanceOf(WorkspaceRuntimeFailure)
  })

  test("forwards an authenticated socket upgrade through the stub", async () => {
    const requests: string[] = []
    const runtime = makeWorkspaceRuntime(
      stub({
        fetch: async (input, init) => {
          const request =
            input instanceof Request ? input : new Request(input, init)
          requests.push(
            `${request.url} ${request.headers.get("upgrade")} ${request.headers.get("x-sylph-user-id")}`
          )
          return new Response(null, { status: 204 })
        },
      })
    )

    const response = await runtime.socket(
      new Request("https://sylph.test/socket", {
        headers: { upgrade: "websocket" },
      }),
      { userId: "user-1", name: "Ada", writable: true }
    )
    expect(response.status).toBe(204)
    expect(requests).toEqual(["https://workspace/socket websocket user-1"])
  })
})
