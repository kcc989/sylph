import { browserJournal } from "./workspace-browser-journal"
import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import {
  BrowserActionReceipt,
  BrowserJourneyResult,
  browserJourneyBlockers,
  type BrowserViewport,
  type WorkspaceBrowserAction,
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
  let reserved = false
  let assertionFails = false
  let actionFails = false
  let screenshotAvailable = true
  let viewport: BrowserViewport = "desktop"
  let conversationId = "conversation-1"
  const journalValues = new Map<
    string,
    | Parameters<ReturnType<typeof browserJournal>["saveResult"]>[0]
    | import("@workspace/domain").BrowserJourneyPolicy
    | import("@workspace/domain").BrowserPolicyException
    | import("@workspace/domain").BrowserActionReceipt
    | number
  >()
  const journal = browserJournal({
    async get(key) {
      return journalValues.get(key)
    },
    async delete(key) {
      return journalValues.delete(key)
    },
    async put(key, value) {
      journalValues.set(key, structuredClone(value))
    },
    async list({ prefix }) {
      return new Map(
        [...journalValues].filter(([key]) => key.startsWith(prefix))
      )
    },
  })
  const layer = () =>
    workspaceBrowserLayer({
      journal,
      async assertWritable() {
        if (reserved) throw new Error("Acceptance in progress")
      },
      async reserveAcceptance() {
        reserved = true
      },
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
          conversationId,
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
                    message: "Could not reconnect",
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
                      if (action.type === "viewport") viewport = action.viewport
                      if (actionFails && action.type === "click")
                        throw new Error("Button was detached")
                      if (action.type === "assert" && assertionFails)
                        throw new Error("Expected one todo, found zero")
                    },
                    async observe() {
                      return {
                        url: "https://preview.example.com/todos",
                        markdown: "Todo list",
                        accessibility: "{}",
                        screenshot: screenshotAvailable
                          ? new Uint8Array([1])
                          : undefined,
                        viewport,
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
    journal,
    events,
    omitScreenshots: () => {
      screenshotAvailable = false
    },
    setUnavailable: () => {
      unavailable = true
    },
    changeConversation: () => {
      conversationId = "conversation-2"
    },
    changeCommit: () => {
      run = newCheckRun({ ...run, commit: "b".repeat(40) })
    },
    failAction: () => {
      actionFails = true
    },
    restoreAssertions: () => {
      assertionFails = false
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
    Effect.flatMap(WorkspaceBrowser, (browser) =>
      browser.execute({ requestId: crypto.randomUUID(), ...input })
    )
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

const requiredAssertion = {
  type: "text",
  selector: "#saved",
  value: "Saved",
} satisfies Extract<WorkspaceBrowserAction, { type: "assert" }>["assertion"]
const policyInput = {
  requirements: [
    {
      id: "save",
      title: "Save and reload",
      assertions: [requiredAssertion],
      viewports: ["desktop", "mobile"],
    },
  ],
  allowedOrigins: [],
  reason: "A user must save at both supported sizes",
} satisfies import("@workspace/domain").BrowserPolicyInput
const configure = (runtime: ReturnType<ReturnType<typeof setup>["runtime"]>) =>
  runtime.runPromise(
    Effect.flatMap(WorkspaceBrowser, (browser) =>
      browser.configure(policyInput, 0, "user-1")
    )
  )
const proof = (runtime: ReturnType<ReturnType<typeof setup>["runtime"]>) =>
  runtime.runPromise(
    Effect.flatMap(WorkspaceBrowser, (browser) => browser.snapshot())
  )
const blockers = async (
  runtime: ReturnType<ReturnType<typeof setup>["runtime"]>
) => {
  const snapshot = await proof(runtime)
  if (!snapshot.binding) throw new Error("Missing test binding")
  return browserJourneyBlockers(snapshot, snapshot.binding)
}
const passJourney = async (
  runtime: ReturnType<ReturnType<typeof setup>["runtime"]>,
  sessionId: string,
  requestId: string = crypto.randomUUID(),
  requirementId = "save"
) => {
  await execute(runtime, {
    sessionId,
    action: { type: "journey_begin", requirementId },
  })
  for (const viewport of policyInput.requirements[0].viewports) {
    await execute(runtime, {
      sessionId,
      action: { type: "viewport", viewport },
    })
    await execute(runtime, {
      sessionId,
      action: { type: "assert", assertion: requiredAssertion },
    })
  }
  return execute(runtime, {
    sessionId,
    requestId,
    action: { type: "journey_finish" },
  })
}
const startSession = async (
  runtime: ReturnType<ReturnType<typeof setup>["runtime"]>
) => {
  const result = await execute(runtime, { action: { type: "start" } })
  if (!result.session) throw new Error("Missing browser session")
  return result.session.id
}

describe("Required browser journey acceptance", () => {
  test("an unscoped failure requires every journey to be repeated", async () => {
    const fixture = setup()
    const runtime = fixture.runtime()
    await runtime.runPromise(
      Effect.flatMap(WorkspaceBrowser, (browser) =>
        browser.configure(
          {
            ...policyInput,
            requirements: [
              ...policyInput.requirements,
              {
                ...policyInput.requirements[0],
                id: "other",
                title: "Another required result",
              },
            ],
          },
          0,
          "user-1"
        )
      )
    )
    const id = await startSession(runtime)
    await passJourney(runtime, id)
    await passJourney(runtime, id, crypto.randomUUID(), "other")
    expect(await blockers(runtime)).toEqual([])
    fixture.failAssertion()
    await execute(runtime, {
      sessionId: id,
      action: { type: "assert", assertion: requiredAssertion },
    })
    fixture.restoreAssertions()
    await passJourney(runtime, id)
    expect((await blockers(runtime)).join(" ")).toContain(
      "Repeat every required journey"
    )
    await passJourney(runtime, id, crypto.randomUUID(), "other")
    expect(await blockers(runtime)).toEqual([])
    await runtime.dispose()
  })
  test("missing screenshots block default proof and require an explicit DOM-only policy revision", async () => {
    const fixture = setup()
    const runtime = fixture.runtime()
    await configure(runtime)
    fixture.omitScreenshots()
    await expect(startSession(runtime)).rejects.toThrow(
      "Screenshot evidence is required"
    )
    expect((await blockers(runtime)).length).toBeGreaterThan(0)
    await runtime.runPromise(
      Effect.flatMap(WorkspaceBrowser, (browser) =>
        browser.configure(
          {
            ...policyInput,
            captureMode: "accessibility",
            reason:
              "The browser platform cannot capture resumed pages; require explicit DOM proof",
          },
          1,
          "user-1"
        )
      )
    )
    const id = await startSession(runtime)
    const result = await passJourney(runtime, id)
    expect(result.evidence.map((item) => item.kind)).toEqual(["accessibility"])
    expect(result.session?.screenshotUrl).toBeUndefined()
    expect(result.detail).toContain("DOM evidence only")
    expect(await blockers(runtime)).toEqual([])
    const snapshot = await proof(runtime)
    expect(snapshot.policy?.revision).toBe(2)
    expect(snapshot.policy?.actorUserId).toBe("user-1")
    expect(snapshot.policy?.captureMode).toBe("accessibility")
    await runtime.dispose()
  })
  test("requires complete responsive proof and retains it after reconnect", async () => {
    const fixture = setup()
    const first = fixture.runtime()
    await configure(first)
    expect(await blockers(first)).toHaveLength(1)
    const sessionId = await startSession(first)
    await execute(first, {
      sessionId,
      action: { type: "journey_begin", requirementId: "save" },
    })
    await execute(first, {
      sessionId,
      action: { type: "assert", assertion: requiredAssertion },
    })
    expect(await blockers(first)).toHaveLength(1)
    await first.dispose()
    const recovered = fixture.runtime()
    await execute(recovered, {
      sessionId,
      action: { type: "viewport", viewport: "mobile" },
    })
    await execute(recovered, {
      sessionId,
      action: { type: "assert", assertion: requiredAssertion },
    })
    const finished = await execute(recovered, {
      sessionId,
      action: { type: "journey_finish" },
    })
    expect(finished.journey?.status).toBe("passed")
    expect(
      finished.journey?.assertions.map((assertion) => assertion.viewport)
    ).toEqual(["desktop", "mobile"])
    expect(await blockers(recovered)).toEqual([])
    await recovered.dispose()
  })

  test("a failed assertion invalidates prior proof until a full explicit retry", async () => {
    const fixture = setup()
    const runtime = fixture.runtime()
    await configure(runtime)
    const sessionId = await startSession(runtime)
    await passJourney(runtime, sessionId)
    fixture.failAssertion()
    const failed = await execute(runtime, {
      sessionId,
      action: { type: "assert", assertion: requiredAssertion },
    })
    expect(failed.outcome).toBe("failed")
    expect(await blockers(runtime)).not.toEqual([])
    fixture.restoreAssertions()
    await execute(runtime, {
      sessionId,
      action: { type: "assert", assertion: requiredAssertion },
    })
    expect(await blockers(runtime)).not.toEqual([])
    await passJourney(runtime, sessionId)
    expect(await blockers(runtime)).toEqual([])
    expect(
      (await fixture.journal.results()).some((item) => item.status === "failed")
    ).toBeTrue()
    await runtime.dispose()
  })

  test("records action failure, incomplete finish, and interrupted close", async () => {
    for (const failure of ["click", "finish", "close", "expire"]) {
      const fixture = setup()
      const runtime = fixture.runtime()
      await configure(runtime)
      const sessionId = await startSession(runtime)
      await execute(runtime, {
        sessionId,
        action: { type: "journey_begin", requirementId: "save" },
      })
      if (failure === "click") {
        fixture.failAction()
        await execute(runtime, {
          sessionId,
          action: { type: "click", selector: "#save" },
        })
      } else if (failure === "expire") fixture.expire()
      else
        await execute(runtime, {
          sessionId,
          action: { type: failure === "close" ? "close" : "journey_finish" },
        })
      expect(await blockers(runtime)).not.toEqual([])
      expect(
        (await proof(runtime)).results.find(
          (item) => item.requirementId === "save"
        )?.status
      ).toBe(
        failure === "click" || failure === "finish" ? "failed" : "interrupted"
      )
      await runtime.dispose()
    }
  })

  test("old proof and policy exceptions never survive a changed binding", async () => {
    for (const change of [
      "changeRun",
      "changeCommit",
      "changeConversation",
    ] as const) {
      const fixture = setup()
      const runtime = fixture.runtime()
      await configure(runtime)
      const sessionId = await startSession(runtime)
      await passJourney(runtime, sessionId)
      const snapshot = await proof(runtime)
      if (!snapshot.binding) throw new Error("Missing binding")
      const binding = snapshot.binding
      await runtime.runPromise(
        Effect.flatMap(WorkspaceBrowser, (browser) =>
          browser.except(
            binding,
            "Manual review for this exact attempt",
            "user-1"
          )
        )
      )
      expect(await blockers(runtime)).toEqual([])
      fixture[change]()
      expect(await blockers(runtime)).not.toEqual([])
      await runtime.dispose()
    }
  })

  test("deduplicates committed actions across reconstruction without replay", async () => {
    const fixture = setup()
    const first = fixture.runtime()
    const sessionId = await startSession(first)
    const input = {
      requestId: "create-once",
      sessionId,
      action: { type: "click", selector: "#save" },
    } satisfies import("@workspace/domain").WorkspaceBrowserToolInput
    const saved = await execute(first, input)
    await first.dispose()
    const recovered = fixture.runtime()
    expect(await execute(recovered, input)).toEqual(saved)
    expect(
      fixture.events.filter((event) => event === "act:click")
    ).toHaveLength(1)
    await expect(
      execute(recovered, { ...input, action: { type: "reload" } })
    ).rejects.toThrow("already used")
    await recovered.dispose()
  })

  test("an interrupted receipt blocks acceptance and cannot replay a mutation", async () => {
    const fixture = setup()
    const runtime = fixture.runtime()
    await configure(runtime)
    const sessionId = await startSession(runtime)
    const input = {
      requestId: "interrupted-save",
      sessionId,
      action: { type: "click", selector: "#save" },
    } satisfies import("@workspace/domain").WorkspaceBrowserToolInput
    const completed = await execute(runtime, input)
    const receipt = await fixture.journal.receipt(input.requestId)
    if (!receipt || !completed.journey) throw new Error("Missing receipt")
    await fixture.journal.saveReceipt(
      input.requestId,
      new BrowserActionReceipt({ ...receipt, result: null })
    )
    await fixture.journal.saveResult(
      new BrowserJourneyResult({ ...completed.journey, status: "running" })
    )
    await expect(execute(runtime, input)).rejects.toThrow("interrupted")
    expect(
      fixture.events.filter((event) => event === "act:click")
    ).toHaveLength(1)
    expect(await blockers(runtime)).not.toEqual([])
    await runtime.dispose()
  })

  test("human takeover uses the same session and blocks agent mutations", async () => {
    const fixture = setup()
    const runtime = fixture.runtime()
    const sessionId = await startSession(runtime)
    const human = (action: WorkspaceBrowserAction) =>
      runtime.runPromise(
        Effect.flatMap(WorkspaceBrowser, (browser) =>
          browser.execute(
            { action, sessionId, requestId: crypto.randomUUID() },
            { userId: "user-1" }
          )
        )
      )
    await human({ type: "take_control" })
    await expect(
      execute(runtime, {
        sessionId,
        action: { type: "click", selector: "#save" },
      })
    ).rejects.toThrow("User controls")
    await human({ type: "click", selector: "#save" })
    expect(fixture.getLaunches()).toBe(1)
    expect(fixture.getSession()?.controller).toBe("human")
    await human({ type: "release_control" })
    await execute(runtime, {
      sessionId,
      action: { type: "click", selector: "#save" },
    })
    expect(
      fixture.events.filter((event) => event === "act:click")
    ).toHaveLength(2)
    await runtime.dispose()
  })
})

test("acceptance reservation excludes subsequent browser actions", async () => {
  const fixture = setup()
  const runtime = fixture.runtime()
  await configure(runtime)
  const sessionId = await startSession(runtime)
  await passJourney(runtime, sessionId)
  const snapshot = await proof(runtime)
  const binding = snapshot.binding
  if (!binding) throw new Error("Missing binding")
  await runtime.runPromise(
    Effect.flatMap(WorkspaceBrowser, (browser) => browser.reserve(binding))
  )
  await expect(execute(runtime, { action: { type: "start" } })).rejects.toThrow(
    "Acceptance in progress"
  )
  await runtime.dispose()
})

test("stale human observations cannot mutate a newer page", async () => {
  const fixture = setup()
  const runtime = fixture.runtime()
  const sessionId = await startSession(runtime)
  await execute(runtime, { sessionId, action: { type: "reload" } })
  await expect(
    execute(runtime, {
      sessionId,
      expectedSequence: 1,
      action: { type: "click", selector: "#save" },
    })
  ).rejects.toThrow("page changed")
  expect(fixture.events).not.toContain("act:click")
  await runtime.dispose()
})

test("a crash after saving a pass but before its receipt blocks acceptance", async () => {
  const fixture = setup()
  const first = fixture.runtime()
  await configure(first)
  const sessionId = await startSession(first)
  await passJourney(first, sessionId, "finish-before-crash")
  const receipt = await fixture.journal.receipt("finish-before-crash")
  if (!receipt) throw new Error("Missing receipt")
  await fixture.journal.saveReceipt(
    "finish-before-crash",
    new BrowserActionReceipt({ ...receipt, result: null })
  )
  await first.dispose()
  const recovered = fixture.runtime()
  expect(await blockers(recovered)).not.toEqual([])
  const interrupted = (await proof(recovered)).results.find(
    (item) => item.id === receipt.journeyId
  )
  expect(interrupted?.status).toBe("interrupted")
  await passJourney(recovered, sessionId)
  expect(await blockers(recovered)).toEqual([])
  await recovered.dispose()
})
