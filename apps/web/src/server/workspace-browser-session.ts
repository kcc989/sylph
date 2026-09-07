import {
  WorkspaceBrowserFailure,
  WorkspaceBrowserResult,
  WorkspaceBrowserSession,
  WorkspaceCheckEvidence,
  type WorkspaceBrowserToolInput,
  type WorkspaceCheckRun,
} from "@workspace/domain"
import { Context, Effect, Layer, Schema } from "effect"

import {
  BrowserRunClient,
  browserIdleTimeout,
  type BrowserConnection,
} from "./browser-run"
import {
  browserEvidenceIds,
  browserTargetUrl,
  bounded,
  evidenceUrl,
} from "./workspace-browser"

const storageKey = "workspace-browser-session"
const decodeSession = Schema.decodeUnknownSync(WorkspaceBrowserSession)

export type WorkspaceBrowserContext = {
  run: WorkspaceCheckRun
  previewUrl: string
  conversationId: string
}

type BrowserSessionOptions = {
  storage: {
    read(): Promise<WorkspaceBrowserSession | undefined>
    write(session: WorkspaceBrowserSession): Promise<void>
    clear(): Promise<void>
  }
  saveEvidence(
    key: string,
    value: string | Uint8Array,
    contentType: string
  ): Promise<void>
  context(): Promise<WorkspaceBrowserContext>
  addEvidence(
    run: WorkspaceCheckRun,
    evidence: ReadonlyArray<WorkspaceCheckEvidence>
  ): void
}

export const durableBrowserSessionStore = (
  storage: Pick<DurableObjectStorage, "get" | "put" | "delete">
): BrowserSessionOptions["storage"] => ({
  async read() {
    const value = await storage.get(storageKey)
    return value === undefined ? undefined : decodeSession(value)
  },
  write: (session) => storage.put(storageKey, session),
  async clear() {
    await storage.delete(storageKey)
  },
})

export class WorkspaceBrowser extends Context.Service<
  WorkspaceBrowser,
  {
    execute(
      input: WorkspaceBrowserToolInput
    ): Effect.Effect<WorkspaceBrowserResult, WorkspaceBrowserFailure>
    close(): Effect.Effect<void, WorkspaceBrowserFailure>
  }
>()("@sylph/server/WorkspaceBrowser") {}

const failure = (cause: unknown) =>
  cause instanceof WorkspaceBrowserFailure
    ? cause
    : new WorkspaceBrowserFailure({
        reason: "action_failed",
        message: cause instanceof Error ? cause.message : String(cause),
      })

export const workspaceBrowserLayer = (options: BrowserSessionOptions) =>
  Layer.effect(
    WorkspaceBrowser,
    Effect.gen(function* () {
      const client = yield* BrowserRunClient
      let pending = Promise.resolve()
      const serial = <A>(operation: () => Promise<A>) => {
        const result = pending.then(operation)
        pending = result.then(
          () => undefined,
          () => undefined
        )
        return result
      }
      const load = options.storage.read
      const connect = (url: string, id?: string) =>
        Effect.runPromise(client.connect(url, id))
      const closeSession = async () => {
        const session = await load()
        if (!session) return
        if (session.expiresAt > Date.now()) {
          await Effect.runPromise(client.close(session.id))
        }
        await options.storage.clear()
      }
      const execute = async (input: WorkspaceBrowserToolInput) => {
        let session = await load()
        const action = input.action ?? {
          type:
            input.path !== undefined || input.url !== undefined
              ? "navigate"
              : "observe",
        }
        if (input.sessionId && input.sessionId !== session?.id)
          throw new WorkspaceBrowserFailure({
            reason: "stale",
            message:
              "This browser session is no longer current. Observe the current session before acting.",
          })
        if (action.type === "close") {
          if (!session)
            throw new WorkspaceBrowserFailure({
              reason: "unavailable",
              message: "There is no browser session to close",
            })
          await closeSession()
          return new WorkspaceBrowserResult({
            url: session.previewUrl,
            checkId: session.checkId,
            session: null,
            outcome: "closed",
            detail:
              "Browser session closed; its login state has been discarded.",
            markdown: "",
            accessibility: "",
            evidence: [],
          })
        }
        const context = await options.context()
        const { run, previewUrl, conversationId } = context
        const target = browserTargetUrl({
          previewUrl,
          path: input.path,
          url: input.url,
        })
        if (action.type === "start") {
          await closeSession()
          session = undefined
        }
        if (
          session &&
          (session.checkId !== run.id ||
            session.commit !== run.commit ||
            session.attempt !== run.attempt ||
            session.workspaceId !== run.workspaceId ||
            session.conversationId !== conversationId ||
            session.previewUrl !== previewUrl)
        ) {
          throw new WorkspaceBrowserFailure({
            reason: "stale",
            message:
              "The Workspace, Conversation, or Checkpoint Preview changed. Start a new browser session before testing it.",
          })
        }
        if (session && session.expiresAt <= Date.now())
          throw new WorkspaceBrowserFailure({
            reason: "expired",
            message:
              "The browser session expired. Start a new session and sign in again; the previous action has not been replayed.",
          })
        const needsSession = !["start", "navigate", "observe"].includes(
          action.type
        )
        if (needsSession && (!session || input.sessionId !== session.id))
          throw new WorkspaceBrowserFailure({
            reason: "unavailable",
            message:
              "Start or observe the browser first, then pass its sessionId with each action.",
          })
        let browser: BrowserConnection
        try {
          browser = await connect(previewUrl, session?.id)
        } catch (error) {
          if (session)
            throw new WorkspaceBrowserFailure({
              reason: "unavailable",
              message:
                "Could not reconnect to the browser. Its session may have expired or still be connected. No action was replayed. Retry observe, or explicitly start a new session.",
            })
          throw error
        }
        try {
          if (!session) {
            session = new WorkspaceBrowserSession({
              id: browser.id,
              workspaceId: run.workspaceId,
              conversationId,
              checkId: run.id,
              commit: run.commit,
              attempt: run.attempt,
              previewUrl,
              sequence: 0,
              expiresAt: Date.now() + browserIdleTimeout,
            })
            try {
              await options.storage.write(session)
              await browser.navigate(browserTargetUrl({ previewUrl }))
              await browser.verify(run.commit)
            } catch (error) {
              await browser.close()
              await options.storage.clear()
              throw error
            }
          }
          session = new WorkspaceBrowserSession({
            ...session,
            sequence: session.sequence + 1,
            expiresAt: Date.now() + browserIdleTimeout,
          })
          await options.storage.write(session)
          let outcome: "observed" | "passed" | "failed" =
            action.type === "assert" ? "passed" : "observed"
          let detail =
            action.type === "assert"
              ? "Assertion passed."
              : `Browser ${action.type} completed. Observe and assert the expected result before reporting a journey as passed.`
          try {
            if (
              action.type === "navigate" ||
              (action.type === "start" &&
                (input.path !== undefined || input.url !== undefined))
            )
              await browser.navigate(target)
            else await browser.act(action)
          } catch (error) {
            outcome = "failed"
            detail = failure(error).message
          }
          const observation = await browser.observe(input.fullPage ?? false)
          const createdAt = Date.now()
          const ids = browserEvidenceIds({
            runId: run.id,
            sequence: session.sequence,
            sessionId: session.id,
          })
          await Promise.all([
            options.saveEvidence(
              `${run.workspaceId}/${ids.screenshot}`,
              observation.screenshot,
              "image/png"
            ),
            options.saveEvidence(
              `${run.workspaceId}/${ids.accessibility}`,
              observation.accessibility,
              "application/json"
            ),
          ])
          const evidence = [
            new WorkspaceCheckEvidence({
              id: ids.screenshot,
              kind: "screenshot",
              label: `Browser ${session.sequence}: ${action.type} (${outcome})`,
              url: evidenceUrl(run.workspaceId, ids.screenshot),
              createdAt,
            }),
            new WorkspaceCheckEvidence({
              id: ids.accessibility,
              kind: "accessibility",
              label: `Browser accessibility ${session.sequence}`,
              url: evidenceUrl(run.workspaceId, ids.accessibility),
              createdAt,
            }),
          ]
          options.addEvidence(run, evidence)
          session = new WorkspaceBrowserSession({
            ...session,
            expiresAt: Date.now() + browserIdleTimeout,
          })
          await options.storage.write(session)
          return new WorkspaceBrowserResult({
            url: observation.url,
            markdown: observation.markdown,
            accessibility: bounded(observation.accessibility, 24_000),
            evidence,
            session,
            checkId: run.id,
            outcome,
            detail,
          })
        } finally {
          await browser.disconnect()
        }
      }
      return WorkspaceBrowser.of({
        execute: Effect.fn("WorkspaceBrowser.execute")(
          (input: WorkspaceBrowserToolInput) =>
            Effect.tryPromise({
              try: () => serial(() => execute(input)),
              catch: failure,
            })
        ),
        close: Effect.fn("WorkspaceBrowser.close")(() =>
          Effect.tryPromise({ try: () => serial(closeSession), catch: failure })
        ),
      })
    })
  )
