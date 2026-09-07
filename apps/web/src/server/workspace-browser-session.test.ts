import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import {
  WorkspaceBrowserFailure,
  WorkspaceBrowserSession,
  WorkspaceBrowserToolInput,
  WorkspaceBrowserToolJsonSchema,
  WorkspaceId,
} from "@workspace/domain"

import { BrowserRunClient, type BrowserConnection } from "./browser-run"
import { newCheckRun } from "./workspace-checks"
import {
  WorkspaceBrowser,
  workspaceBrowserLayer,
} from "./workspace-browser-session"

const setup = () => {
  let session: WorkspaceBrowserSession | undefined
  let run = newCheckRun({
    id: "check-1",
    workspaceId: "workspace-1",
    checkpointId: "checkpoint-1",
    commit: "a".repeat(40),
    kind: "checkpoint",
    attempt: 1,
    createdAt: 1,
  })
  const events: string[] = []
  let active = 0
  let maximumActive = 0
  let launches = 0
  let unavailable = false
  let assertionFails = false
  const layer = () =>
    workspaceBrowserLayer({
      storage: {
        async read() {
          return session
        },
        async write(value) {
          session = value
        },
        async clear() {
          session = undefined
        },
      },
      async saveEvidence(key) {
        events.push(`evidence:${key}`)
      },
      async context() {
        return {
          run,
          previewUrl: "https://preview.example.com",
          conversationId: "conversation-1",
        }
      },
      addEvidence(run, evidence) {
        events.push(`attached:${run.id}:${evidence.length}`)
      },
    }).pipe(
      Layer.provide(
        Layer.succeed(BrowserRunClient, {
          close: () =>
            Effect.sync(() => {
              events.push("close")
            }),
          connect: (_url, id) =>
            unavailable
              ? Effect.fail(
                  new WorkspaceBrowserFailure({
                    reason: "unavailable",
                    message: "Disconnected",
                  })
                )
              : Effect.sync(() => {
                  active++
                  maximumActive = Math.max(maximumActive, active)
                  if (!id) launches++
                  events.push(id ? `connect:${id}` : "launch")
                  return {
                    id: id ?? `session-${launches}`,
                    async navigate(url) {
                      events.push(`navigate:${url}`)
                    },
                    async verify(commit) {
                      events.push(`verify:${commit}`)
                    },
                    async act(action) {
                      events.push(`act:${action.type}`)
                      if (action.type === "assert" && assertionFails)
                        throw new Error("Expected one todo, found zero")
                    },
                    async observe() {
                      return {
                        url: "https://preview.example.com/todos",
                        markdown: "Todo list",
                        accessibility: "{}",
                        screenshot: new Uint8Array([1]),
                      }
                    },
                    async close() {
                      events.push("close")
                    },
                    async disconnect() {
                      active--
                      events.push("disconnect")
                    },
                  } satisfies BrowserConnection
                }),
        })
      )
    )
  const runtime = () => ManagedRuntime.make(layer())
  return {
    runtime,
    events,
    setUnavailable: () => {
      unavailable = true
    },
    failAssertion: () => {
      assertionFails = true
    },
    getSession: () => session,
    expire: () => {
      if (session)
        session = new WorkspaceBrowserSession({ ...session, expiresAt: 0 })
    },
    changeRun: () => {
      run = newCheckRun({ ...run, attempt: 2 })
    },
    getLaunches: () => launches,
    getMaximumActive: () => maximumActive,
  }
}

const execute = (
  runtime: ReturnType<ReturnType<typeof setup>["runtime"]>,
  input: WorkspaceBrowserToolInput
) =>
  runtime.runPromise(
    Effect.flatMap(WorkspaceBrowser, (browser) => browser.execute(input))
  )

describe("Persistent Browser Run session", () => {
  test("reconnects after runtime reconstruction and serializes actions with unique evidence", async () => {
    const fixture = setup()
    const first = fixture.runtime()
    const start = await execute(first, { action: { type: "start" } })
    expect(start.session?.workspaceId).toBe(WorkspaceId.make("workspace-1"))
    await first.dispose()
    const recovered = fixture.runtime()
    const sessionId = start.session?.id
    const results = await Promise.all([
      execute(recovered, {
        sessionId,
        action: { type: "fill", selector: "#todo", value: "Persist this" },
      }),
      execute(recovered, {
        sessionId,
        action: { type: "press", key: "Enter" },
      }),
      execute(recovered, { sessionId, action: { type: "reload" } }),
    ])
    expect(fixture.getLaunches()).toBe(1)
    expect(fixture.getMaximumActive()).toBe(1)
    expect(results.map((result) => result.session?.sequence)).toEqual([2, 3, 4])
    expect(
      new Set(
        results.flatMap((result) => result.evidence.map((item) => item.id))
      ).size
    ).toBe(6)
    expect(
      fixture.events.filter((event) => event.startsWith("verify:"))
    ).toEqual([`verify:${"a".repeat(40)}`])
    expect(fixture.events.filter((event) => event.startsWith("act:"))).toEqual([
      "act:start",
      "act:fill",
      "act:press",
      "act:reload",
    ])
    await recovered.dispose()
  })

  test("keeps failed assertions and their evidence distinct from successful observations", async () => {
    const fixture = setup()
    const runtime = fixture.runtime()
    const start = await execute(runtime, {})
    fixture.failAssertion()
    const result = await execute(runtime, {
      sessionId: start.session?.id,
      action: {
        type: "assert",
        assertion: { type: "count", selector: ".todo", value: 1 },
      },
    })
    expect(result.outcome).toBe("failed")
    expect(result.detail).toContain("found zero")
    expect(result.evidence).toHaveLength(2)
    expect(result.checkId).toBe("check-1")
    await runtime.dispose()
  })

  test("does not launch or replay an action after expiry or a failed reconnect", async () => {
    for (const invalidate of ["expire", "unavailable"]) {
      const fixture = setup()
      const runtime = fixture.runtime()
      const start = await execute(runtime, {})
      if (invalidate === "expire") fixture.expire()
      else fixture.setUnavailable()
      await expect(
        execute(runtime, {
          sessionId: start.session?.id,
          action: { type: "click", selector: "#save" },
        })
      ).rejects.toThrow(/expired|reconnect/)
      expect(fixture.getLaunches()).toBe(1)
      expect(fixture.events).not.toContain("act:click")
      await runtime.dispose()
    }
  })

  test("rejects stale previews and unbound mutations; explicit start replaces a session", async () => {
    const fixture = setup()
    const runtime = fixture.runtime()
    await expect(
      execute(runtime, { action: { type: "click", selector: "#save" } })
    ).rejects.toThrow("Start or observe")
    const start = await execute(runtime, {})
    await expect(
      execute(runtime, { action: { type: "click", selector: "#save" } })
    ).rejects.toThrow("sessionId")
    fixture.changeRun()
    await expect(
      execute(runtime, {
        sessionId: start.session?.id,
        action: { type: "reload" },
      })
    ).rejects.toThrow("Preview changed")
    const restarted = await execute(runtime, { action: { type: "start" } })
    expect(restarted.session?.attempt).toBe(2)
    expect(restarted.session?.id).not.toBe(start.session?.id)
    expect(fixture.events).toContain("close")
    const closed = await execute(runtime, {
      sessionId: restarted.session?.id,
      action: { type: "close" },
    })
    expect(closed.outcome).toBe("closed")
    expect(fixture.getSession()).toBeUndefined()
    await runtime.dispose()
  })

  test("validates actions at the shared tool boundary", () => {
    const decode = Schema.decodeUnknownSync(WorkspaceBrowserToolInput)
    expect(() =>
      decode({ action: { type: "fill", selector: "#name" } })
    ).toThrow()
    expect(() =>
      decode({ action: { type: "evaluate", code: "alert(1)" } })
    ).toThrow()
    expect(() =>
      decode({ action: { type: "scroll", x: 0, y: 99_999 } })
    ).toThrow()
    expect(JSON.stringify(WorkspaceBrowserToolJsonSchema)).toContain(
      "sessionId"
    )
    expect(
      decode({ action: { type: "fill", selector: "#name", value: "" } }).action
        ?.type
    ).toBe("fill")
  })
})
