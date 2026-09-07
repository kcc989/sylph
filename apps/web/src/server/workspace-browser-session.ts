import {
  BrowserActionReceipt,
  BrowserJourneyPolicy,
  BrowserJourneyResult,
  BrowserJourneySnapshot,
  BrowserPolicyException,
  browserProofMatches,
  browserJourneyBlockers,
  WorkspaceBrowserFailure,
  WorkspaceBrowserResult,
  WorkspaceBrowserSession,
  WorkspaceBrowserToolInput,
  WorkspaceCheckEvidence,
  type BrowserPolicyInput,
  type BrowserProofBinding,
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
  validateBrowserOrigins,
} from "./workspace-browser"
import type { BrowserJournal } from "./workspace-browser-journal"

const storageKey = "workspace-browser-session"
const decodeSession = Schema.decodeUnknownSync(WorkspaceBrowserSession)
const decodeInput = Schema.decodeUnknownSync(WorkspaceBrowserToolInput)

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
  assertWritable(): Promise<void>
  reserveAcceptance(): Promise<void>
  journal: BrowserJournal
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

type BrowserActor = { userId: string } | undefined

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
      input: WorkspaceBrowserToolInput,
      actor?: BrowserActor
    ): Effect.Effect<WorkspaceBrowserResult, WorkspaceBrowserFailure>
    snapshot(): Effect.Effect<BrowserJourneySnapshot, WorkspaceBrowserFailure>
    configure(
      policy: BrowserPolicyInput,
      expectedRevision: number,
      userId: string
    ): Effect.Effect<void, WorkspaceBrowserFailure>
    except(
      binding: BrowserProofBinding,
      reason: string,
      userId: string
    ): Effect.Effect<void, WorkspaceBrowserFailure>
    reserve(
      binding: BrowserProofBinding
    ): Effect.Effect<void, WorkspaceBrowserFailure>
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
const reject = (
  message: string,
  reason: WorkspaceBrowserFailure["reason"] = "action_failed"
) => {
  throw new WorkspaceBrowserFailure({ reason, message })
}
const bindingFor = (
  { run, conversationId }: WorkspaceBrowserContext,
  revision: number
): BrowserProofBinding => ({
  workspaceId: run.workspaceId,
  conversationId,
  checkId: run.id,
  commit: run.commit,
  attempt: run.attempt,
  policyRevision: revision,
})
const fingerprint = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

export const workspaceBrowserLayer = (options: BrowserSessionOptions) =>
  Layer.effect(
    WorkspaceBrowser,
    Effect.gen(function* () {
      const client = yield* BrowserRunClient
      const journal = options.journal
      let pending = Promise.resolve()
      const serial = <A>(operation: () => Promise<A>) => {
        const result = pending.then(operation)
        pending = result.then(
          () => undefined,
          () => undefined
        )
        return result
      }
      const operation = <A>(run: () => Promise<A>) =>
        Effect.tryPromise({ try: () => serial(run), catch: failure })
      const load = options.storage.read
      const interrupt = async (
        session: WorkspaceBrowserSession | undefined,
        detail: string
      ) => {
        if (!session?.journeyId) return
        const journey = await journal.result(session.journeyId)
        if (journey?.status === "running")
          await journal.saveResult(
            new BrowserJourneyResult({
              ...journey,
              status: "interrupted",
              detail,
              updatedAt: Date.now(),
              ordinal: await journal.nextOrdinal(),
            })
          )
      }
      const closeSession = async () => {
        const session = await load()
        if (!session) return
        await interrupt(session, "Browser closed before the journey finished.")
        if (session.expiresAt > Date.now())
          await Effect.runPromise(client.close(session.id))
        await options.storage.clear()
      }
      const snapshot = async () => {
        for (const pending of await journal.pendingReceipts()) {
          const receipt = (await journal.receipt(pending.id)) ?? pending.receipt
          if (!receipt.result && receipt.journeyId) {
            const journey = await journal.result(receipt.journeyId)
            if (journey?.status === "running" || journey?.status === "passed") {
              await journal.saveResult(
                new BrowserJourneyResult({
                  ...journey,
                  status: "interrupted",
                  detail:
                    "An action did not durably finish. Begin a new journey attempt.",
                  updatedAt: Date.now(),
                  ordinal: await journal.nextOrdinal(),
                })
              )
            }
          }
          await journal.saveReceipt(
            pending.id,
            new BrowserActionReceipt({
              ...receipt,
              interrupted: !receipt.result,
            })
          )
        }
        const policy = await journal.policy()
        const session = await load()
        if (session && session.expiresAt <= Date.now())
          await interrupt(
            session,
            "Browser session expired before the journey finished."
          )
        const context = await options.context().catch(() => undefined)
        return new BrowserJourneySnapshot({
          policy: policy ?? null,
          binding: context ? bindingFor(context, policy?.revision ?? 0) : null,
          results: await journal.results(),
          exception: (await journal.exception()) ?? null,
          session: session ?? null,
        })
      }
      const execute = async (
        raw: WorkspaceBrowserToolInput,
        actor: BrowserActor
      ) => {
        const input = decodeInput(raw)
        const action = input.action ?? {
          type:
            input.path !== undefined || input.url !== undefined
              ? "navigate"
              : "observe",
        }
        if (action.type !== "observe" && !input.requestId)
          reject(
            "Pass a unique requestId for each browser action. Reuse it only when retrying the same call."
          )
        await options.assertWritable()
        const context = await options.context()
        const { run, previewUrl, conversationId } = context
        const policy = await journal.policy()
        const binding = bindingFor(context, policy?.revision ?? 0)
        const requestId = input.requestId ?? crypto.randomUUID()
        const actorId = actor?.userId ?? "agent"
        const signature = await fingerprint(
          JSON.stringify({ input, binding, actor: actorId })
        )
        const receipt = await journal.receipt(requestId)
        if (receipt) {
          if (receipt.fingerprint !== signature)
            reject(
              "This requestId was already used for a different action or Check attempt.",
              "stale"
            )
          if (receipt.result) return receipt.result
          if (receipt.journeyId) {
            const interrupted = await journal.result(receipt.journeyId)
            if (interrupted?.status === "running")
              await journal.saveResult(
                new BrowserJourneyResult({
                  ...interrupted,
                  status: "interrupted",
                  detail:
                    "The previous action did not finish. It has not been replayed.",
                  updatedAt: Date.now(),
                  ordinal: await journal.nextOrdinal(),
                })
              )
          }
          reject(
            "The previous action was interrupted. Observe the browser, then begin a new journey. This action has not been replayed."
          )
        }
        let session = await load()
        if (
          input.expectedSequence !== undefined &&
          input.expectedSequence !== session?.sequence
        )
          reject(
            "The browser page changed after your observation. Observe it before acting.",
            "stale"
          )
        if (input.sessionId && input.sessionId !== session?.id)
          reject(
            "This browser session is no longer current. Observe before acting.",
            "stale"
          )
        if (
          session?.controller === "human" &&
          !actor &&
          action.type !== "observe"
        )
          reject(
            "A User controls this browser. Wait for the User to release control."
          )
        if (
          actor &&
          session?.controller === "human" &&
          session.controllerUserId !== actor.userId &&
          !["observe", "take_control"].includes(action.type)
        )
          reject(
            "Another User controls this browser. Take control before acting."
          )
        if (
          (action.type === "take_control" ||
            action.type === "release_control") &&
          !actor
        )
          reject("Only a User can change browser control.")
        if (
          actor &&
          session &&
          session.controller !== "human" &&
          !["observe", "take_control", "start"].includes(action.type)
        )
          reject("Take control before using the browser.")
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
          await interrupt(
            session,
            "The Workspace, Conversation, or Checkpoint Preview changed."
          )
          reject(
            "The Workspace, Conversation, or Checkpoint Preview changed. Start a new browser session.",
            "stale"
          )
        }
        if (
          session &&
          session.expiresAt <= Date.now() &&
          action.type !== "close"
        ) {
          await interrupt(session, "Browser session expired.")
          reject(
            "The browser session expired. Start again; no action was replayed.",
            "expired"
          )
        }
        if (
          !["start", "navigate", "observe"].includes(action.type) &&
          (!session || input.sessionId !== session.id)
        )
          reject(
            "Start or observe the browser first, then pass its sessionId with each action.",
            "unavailable"
          )
        let journey = session?.journeyId
          ? await journal.result(session.journeyId)
          : undefined
        if (journey?.status !== "running") journey = undefined
        if (action.type === "journey_begin") {
          if (
            !policy?.requirements.some(
              (item) => item.id === action.requirementId
            )
          )
            reject("Choose a required journey from the User's browser policy.")
          await interrupt(
            session,
            "A new journey attempt replaced the unfinished journey."
          )
          journey = undefined
        }
        const durableAction = ![
          "observe",
          "close",
          "take_control",
          "release_control",
        ].includes(action.type)
        if (!journey && (durableAction || action.type === "observe")) {
          journey = new BrowserJourneyResult({
            id: crypto.randomUUID(),
            binding,
            requirementId:
              action.type === "journey_begin"
                ? action.requirementId
                : "exploratory",
            sessionId: session?.id ?? "starting",
            status: "running",
            assertions: [],
            startedAt: Date.now(),
            updatedAt: Date.now(),
            ordinal: await journal.nextOrdinal(),
            detail: "Browser action in progress.",
          })
          await journal.saveResult(journey)
        }
        const pendingReceipt = new BrowserActionReceipt({
          fingerprint: signature,
          journeyId: journey?.id ?? null,
          actor: actorId,
          action: action.type,
          createdAt: Date.now(),
          result: null,
        })
        await journal.saveReceipt(requestId, pendingReceipt)
        const finishReceipt = async (result: WorkspaceBrowserResult) => {
          await journal.saveReceipt(
            requestId,
            new BrowserActionReceipt({ ...pendingReceipt, result })
          )
          return result
        }
        if (action.type === "close" && session) {
          await closeSession()
          return await finishReceipt(
            new WorkspaceBrowserResult({
              url: previewUrl,
              checkId: run.id,
              session: null,
              outcome: "closed",
              detail: "Browser closed; login state discarded.",
              markdown: "",
              accessibility: "",
              evidence: [],
              policy,
            })
          )
        }
        let browser: BrowserConnection | undefined
        const disconnect = async () => {
          try {
            await browser?.disconnect()
          } catch (cause) {
            if (journey)
              await journal.saveResult(
                new BrowserJourneyResult({
                  ...journey,
                  status: "interrupted",
                  detail: failure(cause).message,
                  updatedAt: Date.now(),
                  ordinal: await journal.nextOrdinal(),
                })
              )
            await journal.saveReceipt(
              requestId,
              new BrowserActionReceipt({
                ...pendingReceipt,
                interrupted: true,
              })
            )
            throw cause
          }
        }
        try {
          const target = browserTargetUrl({
            previewUrl,
            path: input.path,
            url: input.url,
            allowedOrigins: policy?.allowedOrigins,
          })
          browser = await Effect.runPromise(
            client.connect(previewUrl, session?.id, {
              allowedOrigins: policy?.allowedOrigins ?? [],
              viewport: session?.viewport ?? "desktop",
              pageId: session?.pageId,
            })
          )
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
              controller: actor ? "human" : "agent",
              controllerUserId: actor?.userId,
              viewport: "desktop",
            })
            await options.storage.write(session)
          }
          if (!session.identityVerified) {
            await browser.navigate(browserTargetUrl({ previewUrl }))
            await browser.verify(run.commit)
            session = new WorkspaceBrowserSession({
              ...session,
              identityVerified: true,
            })
            await options.storage.write(session)
          }
          session = new WorkspaceBrowserSession({
            ...session,
            sequence: session.sequence + 1,
            expiresAt: Date.now() + browserIdleTimeout,
            journeyId:
              journey?.requirementId !== "exploratory"
                ? journey?.id
                : undefined,
            controller:
              action.type === "take_control"
                ? "human"
                : action.type === "release_control"
                  ? "agent"
                  : session.controller,
            controllerUserId:
              action.type === "take_control"
                ? actor?.userId
                : action.type === "release_control"
                  ? undefined
                  : session.controllerUserId,
          })
          await options.storage.write(session)
          let outcome: "observed" | "passed" | "failed" =
            action.type === "assert" || action.type === "journey_finish"
              ? "passed"
              : "observed"
          let detail = `Browser ${action.type} completed.`
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
          const currentContext = await options.context()
          if (
            !browserProofMatches(
              binding,
              bindingFor(
                currentContext,
                (await journal.policy())?.revision ?? 0
              )
            )
          )
            reject(
              "The Check or Conversation changed while the browser action ran.",
              "stale"
            )
          options.addEvidence(run, evidence)
          session = new WorkspaceBrowserSession({
            ...session,
            screenshotUrl: evidenceUrl(run.workspaceId, ids.screenshot),
            currentUrl: observation.url,
            viewport: observation.viewport ?? session.viewport,
            pageId: observation.pageId ?? session.pageId,
            expiresAt: Date.now() + browserIdleTimeout,
          })
          if (journey) {
            const requirement = policy?.requirements.find(
              (item) => item.id === journey?.requirementId
            )
            let assertions = journey.assertions
            const viewport = session.viewport ?? "desktop"
            const index = assertions.filter(
              (item) => item.viewport === viewport
            ).length
            if (
              outcome === "passed" &&
              action.type === "assert" &&
              requirement?.viewports.includes(viewport) &&
              JSON.stringify(requirement.assertions[index]) ===
                JSON.stringify(action.assertion)
            ) {
              assertions = [
                ...assertions,
                {
                  viewport,
                  index,
                  sequence: session.sequence,
                  evidenceIds: evidence.map((item) => item.id),
                },
              ]
            }
            if (
              action.type === "journey_finish" &&
              (!requirement ||
                requirement.viewports.some(
                  (viewport) =>
                    assertions.filter((item) => item.viewport === viewport)
                      .length !== requirement.assertions.length
                ) ||
                new URL(observation.url).origin !== new URL(previewUrl).origin)
            ) {
              outcome = "failed"
              detail =
                "The journey is incomplete. Pass every required assertion in order at each required viewport, then finish on the application Preview. Begin a new attempt."
            }
            journey = new BrowserJourneyResult({
              ...journey,
              sessionId: session.id,
              assertions,
              status:
                outcome === "failed"
                  ? "failed"
                  : action.type === "journey_finish" ||
                      journey.requirementId === "exploratory"
                    ? "passed"
                    : "running",
              detail,
              updatedAt: Date.now(),
              ordinal: await journal.nextOrdinal(),
            })
            await journal.saveResult(journey)
            if (journey.status !== "running")
              session = new WorkspaceBrowserSession({
                ...session,
                journeyId: undefined,
              })
          }
          await options.storage.write(session)
          return await finishReceipt(
            new WorkspaceBrowserResult({
              url: observation.url,
              markdown: observation.markdown,
              accessibility: bounded(observation.accessibility, 24_000),
              evidence,
              session,
              checkId: run.id,
              outcome,
              detail,
              journey,
              policy,
              pages: observation.pages,
            })
          )
        } catch (error) {
          if (journey)
            await journal.saveResult(
              new BrowserJourneyResult({
                ...journey,
                status: "interrupted",
                detail: failure(error).message,
                updatedAt: Date.now(),
                ordinal: await journal.nextOrdinal(),
              })
            )
          throw error
        } finally {
          await disconnect()
        }
      }
      return WorkspaceBrowser.of({
        execute: Effect.fn("WorkspaceBrowser.execute")((input, actor) =>
          operation(() => execute(input, actor))
        ),
        snapshot: Effect.fn("WorkspaceBrowser.snapshot")(() =>
          operation(snapshot)
        ),
        configure: Effect.fn("WorkspaceBrowser.configure")(
          (input, expectedRevision, userId) =>
            operation(async () => {
              await options.assertWritable()
              const current = await journal.policy()
              if ((current?.revision ?? 0) !== expectedRevision)
                reject(
                  "Browser policy changed. Refresh before saving.",
                  "stale"
                )
              validateBrowserOrigins(input.allowedOrigins)
              const ids = input.requirements.map((item) => item.id)
              if (
                ids.includes("exploratory") ||
                new Set(ids).size !== ids.length
              )
                reject(
                  "Required journey IDs must be unique; exploratory is reserved."
                )
              for (const item of input.requirements)
                if (new Set(item.viewports).size !== item.viewports.length)
                  reject("Each viewport must appear once per journey.")
              await closeSession()
              await journal.savePolicy(
                new BrowserJourneyPolicy({
                  ...input,
                  revision: expectedRevision + 1,
                  actorUserId: userId,
                  createdAt: Date.now(),
                })
              )
            })
        ),
        except: Effect.fn("WorkspaceBrowser.except")(
          (binding, reason, userId) =>
            operation(async () => {
              await options.assertWritable()
              const policy = await journal.policy()
              const current = bindingFor(
                await options.context(),
                policy?.revision ?? 0
              )
              if (!policy || !browserProofMatches(binding, current))
                reject(
                  "The Check or policy changed. Refresh before recording an exception.",
                  "stale"
                )
              await closeSession()
              await journal.saveException(
                new BrowserPolicyException({
                  binding,
                  reason,
                  actorUserId: userId,
                  createdAt: Date.now(),
                  ordinal: await journal.nextOrdinal(),
                })
              )
            })
        ),
        reserve: Effect.fn("WorkspaceBrowser.reserve")((binding) =>
          operation(async () => {
            await options.assertWritable()
            const current = await snapshot()
            if (
              !current.binding ||
              !browserProofMatches(current.binding, binding)
            )
              reject("Browser proof changed before Acceptance.", "stale")
            const blockers = browserJourneyBlockers(current, binding)
            if (blockers.length) reject(blockers.join(" "))
            await closeSession()
            await options.reserveAcceptance()
          })
        ),
        close: Effect.fn("WorkspaceBrowser.close")(() =>
          operation(closeSession)
        ),
      })
    })
  )
