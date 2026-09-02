import { describe, expect, test } from "bun:test"
import {
  GitCommitId,
  PreconditionFailed,
  serializeServerFailure,
  WorkspaceCheckpointInput,
  WorkspaceId,
  WorkspaceReadOnly,
  WorkspaceRuntimeFailure,
  WorkspaceTurnCancelInput,
} from "@workspace/domain"

import {
  makeWorkspaceRuntime,
  type WorkspaceRuntimeStub,
} from "./workspace-runtime-client"

const unreachable = () => Promise.reject(new Error("not expected"))

const stub = (
  overrides: Partial<WorkspaceRuntimeStub>
): WorkspaceRuntimeStub => ({
  prepareProject: unreachable,
  synchronizeProject: unreachable,
  connectKey: unreachable,
  startSubscriptionSignIn: unreachable,
  subscriptionSignInStatus: unreachable,
  cancelSubscriptionSignIn: unreachable,
  initialize: unreachable,
  checkpoint: unreachable,
  listChecks: unreachable,
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
  answerQuestion: unreachable,
  discard: unreachable,
  evict: unreachable,
  snapshot: unreachable,
  fetch: unreachable,
  ...overrides,
})

const workspaceId = WorkspaceId.make("workspace-1")
const malformedChecks = JSON.parse('[{"id":"broken"}]')
const commit = GitCommitId.make("a".repeat(40))

describe("Workspace runtime client", () => {
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

  test("streams events through the stub's fetch surface", async () => {
    const requests: string[] = []
    const runtime = makeWorkspaceRuntime(
      stub({
        fetch: async (input, init) => {
          requests.push(`${input} ${new Headers(init?.headers).get("accept")}`)
          return new Response("data: hello\n\n")
        },
      })
    )

    const response = await runtime.events()
    expect(await response.text()).toBe("data: hello\n\n")
    expect(requests).toEqual(["https://workspace/events text/event-stream"])
  })
})
