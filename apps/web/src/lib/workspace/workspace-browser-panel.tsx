import { useRef, useState } from "react"
import {
  browserJourneyBlockers,
  browserProofMatches,
  type BrowserJourneySnapshot,
  type BrowserJourneyRequirement,
  type WorkspaceBrowserAction,
  type WorkspaceBrowserResult,
  type WorkspaceBrowserToolInput,
  type WorkspaceHumanBrowserInput,
  type WorkspaceBrowserPolicyInput,
  type WorkspaceBrowserExceptionInput,
} from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"

const fieldClass =
  "min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function WorkspaceBrowserPanelView({
  workspaceId,
  userId,
  proof,
  previewUrl,
  refresh,
  readOnly,
  control,
  configure,
  except,
}: {
  workspaceId: string
  userId: string
  proof: typeof BrowserJourneySnapshot.Encoded | undefined
  previewUrl: string
  refresh: () => Promise<void>
  readOnly: boolean
  control: (request: {
    data: typeof WorkspaceHumanBrowserInput.Encoded
  }) => Promise<typeof WorkspaceBrowserResult.Encoded>
  configure: (request: {
    data: typeof WorkspaceBrowserPolicyInput.Encoded
  }) => Promise<void>
  except: (request: {
    data: typeof WorkspaceBrowserExceptionInput.Encoded
  }) => Promise<void>
}) {
  const [result, setResult] = useState<
    typeof WorkspaceBrowserResult.Encoded | null
  >(null)
  const request = useRef<WorkspaceBrowserToolInput | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<"run" | "iframe">("run")
  const [text, setText] = useState("")
  const [selector, setSelector] = useState("")
  const [location, setLocation] = useState("")
  const [reason, setReason] = useState("")
  const [editing, setEditing] = useState(false)
  const [requirements, setRequirements] = useState<
    ReadonlyArray<BrowserJourneyRequirement>
  >([])
  const [origins, setOrigins] = useState("")
  const [captureMode, setCaptureMode] = useState<
    "screenshots" | "accessibility"
  >("screenshots")
  const session = proof?.session
  const controlling =
    session?.controller === "human" && session.controllerUserId === userId
  const disabled = pending || readOnly
  const blockers = proof?.binding
    ? browserJourneyBlockers(proof, proof.binding)
    : [
        "Check the current changes to create a Preview, then set the required journeys.",
      ]
  const run = async (operation: () => Promise<void>) => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Browser request failed. Observe the session before retrying."
      )
    } finally {
      try {
        await refresh()
      } finally {
        setPending(false)
      }
    }
  }
  const act = (action: WorkspaceBrowserAction, url?: string) =>
    run(async () => {
      const target = url
        ? new URL(url, session?.previewUrl ?? previewUrl).href
        : undefined
      const previous = request.current
      const sessionId = action.type === "start" ? undefined : session?.id
      const same =
        previous &&
        previous.sessionId === sessionId &&
        previous.url === target &&
        JSON.stringify(previous.action) === JSON.stringify(action)
      if (
        previous &&
        !same &&
        action.type !== "observe" &&
        action.type !== "start"
      )
        throw new Error(
          "The last browser request did not return. Retry the same action or observe the page before taking another action."
        )
      const input = same
        ? previous
        : {
            action,
            sessionId,
            requestId: crypto.randomUUID(),
            expectedSequence:
              action.type === "start" || action.type === "observe"
                ? undefined
                : session?.sequence,
            url: target,
          }
      request.current = input
      const response = await control({ data: { workspaceId, input } })
      request.current = null
      setResult(response)
      if (response.outcome === "failed")
        setError(response.detail ?? "Browser action failed.")
    })
  const editRequirement = (
    id: string,
    replacement: BrowserJourneyRequirement
  ) =>
    setRequirements((items) =>
      items.map((item) => (item.id === id ? replacement : item))
    )
  const editPolicy = () => {
    setRequirements(proof?.policy?.requirements ?? [])
    setOrigins(proof?.policy?.allowedOrigins.join("\n") ?? "")
    setCaptureMode(proof?.policy?.captureMode ?? "screenshots")
    setReason("")
    setEditing(true)
  }
  const currentResult = result?.session?.id === session?.id ? result : null
  const currentJourney = proof?.results.find(
    (item) => item.id === session?.journeyId
  )
  const currentRequirement = proof?.policy?.requirements.find(
    (item) => item.id === currentJourney?.requirementId
  )
  const nextAssertion =
    currentRequirement?.assertions[
      currentJourney?.assertions.filter(
        (item) => item.viewport === (session?.viewport ?? "desktop")
      ).length ?? 0
    ]

  return (
    <div className="flex min-h-full flex-col text-sm">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Button
          size="xs"
          variant={mode === "run" ? "secondary" : "ghost"}
          onClick={() => setMode("run")}
        >
          Browser Run
        </Button>
        <Button
          size="xs"
          variant={mode === "iframe" ? "secondary" : "ghost"}
          onClick={() => setMode("iframe")}
        >
          Application iframe
        </Button>
        <span className="text-xs text-muted-foreground">
          {mode === "run"
            ? "Shared human and agent session"
            : "Separate session · does not prove a journey"}
        </span>
      </div>
      {mode === "iframe" ? (
        <iframe
          className="min-h-[32rem] flex-1 border-0 bg-white"
          sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
          referrerPolicy="no-referrer"
          title="Application preview in a separate session"
          src={previewUrl}
        />
      ) : (
        <>
          <div className="space-y-3 border-b p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="font-medium">Required journeys</strong>
              <Button
                size="xs"
                variant="outline"
                disabled={disabled}
                onClick={editPolicy}
              >
                {proof?.policy ? "Edit policy" : "Set policy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Homepage identity is checked separately. Acceptance requires these
              journeys for the current Conversation and Check attempt.
            </p>
            <ul className="space-y-2">
              {proof?.policy?.requirements.map((requirement) => {
                const latest = proof.results
                  .filter(
                    (item) =>
                      item.requirementId === requirement.id &&
                      proof.binding &&
                      browserProofMatches(item.binding, proof.binding)
                  )
                  .sort((a, b) => b.ordinal - a.ordinal)[0]
                return (
                  <li
                    key={requirement.id}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="min-w-0 break-words">
                      {requirement.title}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {latest?.status ?? "missing"} ·{" "}
                        {requirement.viewports.join(" + ")}
                      </span>
                    </span>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={disabled || !session || !controlling}
                      onClick={() =>
                        void act({
                          type: "journey_begin",
                          requirementId: requirement.id,
                        })
                      }
                    >
                      Begin attempt
                    </Button>
                  </li>
                )
              })}
            </ul>
            {blockers.length ? (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-foreground">
                Browser acceptance requirement satisfied
                {proof?.exception
                  ? "; policy exception recorded when applicable"
                  : ""}
                .
              </p>
            )}
            {proof?.policy ? (
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Policy and exception
                </summary>
                <p className="mt-2 text-xs break-words">
                  Revision {proof.policy.revision} by {proof.policy.actorUserId}
                  : {proof.policy.reason}
                </p>
                {proof.exception ? (
                  <p className="mt-2 text-xs break-words">
                    Exception by {proof.exception.actorUserId} for Check{" "}
                    {proof.exception.binding.checkId}, attempt{" "}
                    {proof.exception.binding.attempt}, commit{" "}
                    {proof.exception.binding.commit.slice(0, 7)}:{" "}
                    {proof.exception.reason}
                  </p>
                ) : null}
                <form
                  className="mt-3 flex flex-wrap gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const binding = proof.binding
                    if (binding)
                      void run(async () => {
                        await except({ data: { workspaceId, binding, reason } })
                        setReason("")
                      })
                  }}
                >
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
                    Reason for accepting without complete journey proof
                    <textarea
                      className={fieldClass}
                      required
                      minLength={1}
                      maxLength={2000}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </label>
                  <Button
                    type="submit"
                    className="self-end"
                    size="sm"
                    variant="outline"
                    disabled={disabled || !proof.binding}
                  >
                    Record exception
                  </Button>
                </form>
              </details>
            ) : null}
          </div>
          {editing ? (
            <form
              className="space-y-4 border-b p-3"
              onSubmit={(event) => {
                event.preventDefault()
                void run(async () => {
                  await configure({
                    data: {
                      workspaceId,
                      expectedRevision: proof?.policy?.revision ?? 0,
                      policy: {
                        requirements,
                        allowedOrigins: origins.split(/\s+/).filter(Boolean),
                        captureMode,
                        reason,
                      },
                    },
                  })
                  setEditing(false)
                })
              }}
            >
              <p className="text-xs text-muted-foreground">
                List the results a user must see, in order. Each assertion must
                pass at each selected viewport. Saving a policy closes the
                current session and requires new proof.
              </p>
              <label className="flex flex-col gap-1 text-xs">
                Required evidence
                <select
                  className={fieldClass}
                  value={captureMode}
                  onChange={(event) =>
                    setCaptureMode(
                      event.target.value === "accessibility"
                        ? "accessibility"
                        : "screenshots"
                    )
                  }
                >
                  <option value="screenshots">
                    Screenshots and DOM assertions
                  </option>
                  <option value="accessibility">
                    DOM testing (no screenshots or pointer checks)
                  </option>
                </select>
                <span className="text-muted-foreground">
                  DOM testing activates controls in the real document. It does
                  not verify visual appearance or pointer hit targets. Explain
                  this choice in the policy reason.
                </span>
              </label>
              {requirements.map((requirement) => (
                <fieldset
                  key={requirement.id}
                  className="space-y-2 border-b pb-3"
                >
                  <legend className="sr-only">Required journey</legend>
                  <div className="flex gap-2">
                    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
                      Journey name
                      <input
                        className={fieldClass}
                        required
                        maxLength={200}
                        value={requirement.title}
                        onChange={(event) =>
                          editRequirement(requirement.id, {
                            ...requirement,
                            title: event.target.value,
                          })
                        }
                      />
                    </label>
                    <Button
                      className="self-end"
                      size="sm"
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setRequirements((items) =>
                          items.filter((item) => item.id !== requirement.id)
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  {requirement.assertions.map((assertion, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-2">
                      <label className="flex min-w-0 flex-col gap-1 text-xs">
                        Step {index + 1}: CSS selector
                        <input
                          className={fieldClass}
                          required
                          value={assertion.selector}
                          onChange={(event) =>
                            editRequirement(requirement.id, {
                              ...requirement,
                              assertions: requirement.assertions.map(
                                (item, position) =>
                                  position === index
                                    ? { ...item, selector: event.target.value }
                                    : item
                              ),
                            })
                          }
                        />
                      </label>
                      <label className="flex min-w-0 flex-col gap-1 text-xs">
                        Expected {assertion.type}
                        <input
                          className={fieldClass}
                          value={String(assertion.value)}
                          onChange={(event) =>
                            editRequirement(requirement.id, {
                              ...requirement,
                              assertions: requirement.assertions.map(
                                (item, position) =>
                                  position !== index
                                    ? item
                                    : item.type === "count"
                                      ? {
                                          ...item,
                                          value: Number(event.target.value),
                                        }
                                      : item.type === "checked" ||
                                          item.type === "visible"
                                        ? {
                                            ...item,
                                            value:
                                              event.target.value === "true",
                                          }
                                        : { ...item, value: event.target.value }
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      size="xs"
                      type="button"
                      variant="outline"
                      disabled={requirement.assertions.length >= 30}
                      onClick={() =>
                        editRequirement(requirement.id, {
                          ...requirement,
                          assertions: [
                            ...requirement.assertions,
                            { type: "text", selector: "", value: "" },
                          ],
                        })
                      }
                    >
                      Add text assertion
                    </Button>
                    {(["desktop", "mobile"] as const).map((viewport) => (
                      <label
                        key={viewport}
                        className="flex items-center gap-1.5 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={requirement.viewports.includes(viewport)}
                          onChange={(event) =>
                            editRequirement(requirement.id, {
                              ...requirement,
                              viewports: event.target.checked
                                ? [...requirement.viewports, viewport]
                                : requirement.viewports.filter(
                                    (item) => item !== viewport
                                  ),
                            })
                          }
                        />
                        {viewport === "desktop"
                          ? "Desktop 1440 × 900"
                          : "Mobile 390 × 844"}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <Button
                size="xs"
                type="button"
                variant="outline"
                disabled={requirements.length >= 20}
                onClick={() =>
                  setRequirements((items) => [
                    ...items,
                    {
                      id: crypto.randomUUID(),
                      title: "",
                      viewports: ["desktop", "mobile"],
                      assertions: [{ type: "text", selector: "", value: "" }],
                    },
                  ])
                }
              >
                Add journey
              </Button>
              <label className="flex flex-col gap-1 text-xs">
                Allowed OAuth origins
                <textarea
                  className={fieldClass}
                  value={origins}
                  onChange={(event) => setOrigins(event.target.value)}
                  placeholder="https://accounts.example.com"
                />
                <span className="text-muted-foreground">
                  Optional. Exact HTTPS origins only. Navigation to other
                  origins is blocked.
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Reason for this policy
                <textarea
                  className={fieldClass}
                  required
                  maxLength={2000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={disabled}>
                  Save policy
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 border-b p-3">
            <Button
              size="xs"
              disabled={disabled}
              onClick={() => void act({ type: "start" })}
            >
              {session ? "Start new session" : "Start browser"}
            </Button>
            {session ? (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    void act({
                      type: controlling ? "release_control" : "take_control",
                    })
                  }
                >
                  {controlling ? "Release to agent" : "Take control"}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => void act({ type: "observe" })}
                >
                  Observe
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={disabled || !controlling}
                  onClick={() => void act({ type: "reload" })}
                >
                  Reload
                </Button>
                <select
                  className={fieldClass}
                  aria-label="Browser Run viewport"
                  disabled={disabled || !controlling}
                  value={session.viewport ?? "desktop"}
                  onChange={(event) =>
                    void act({
                      type: "viewport",
                      viewport:
                        event.target.value === "mobile" ? "mobile" : "desktop",
                    })
                  }
                >
                  <option value="desktop">Desktop 1440 × 900</option>
                  <option value="mobile">Mobile 390 × 844</option>
                </select>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={disabled || !controlling}
                  onClick={() => void act({ type: "close" })}
                >
                  Close
                </Button>
                <span className="text-xs text-muted-foreground">
                  {controlling ? "Human control" : "Agent control"} · attempt{" "}
                  {session.attempt} · {session.commit.slice(0, 7)} · action{" "}
                  {session.sequence}
                </span>
              </>
            ) : null}
          </div>
          {session ? (
            <label className="flex flex-col gap-1 border-b p-3 text-xs">
              Shared browser URL
              <input
                className={fieldClass}
                readOnly
                value={session.currentUrl ?? session.previewUrl}
              />
            </label>
          ) : null}
          {session && controlling ? (
            <div className="space-y-3 border-b p-3">
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void act({ type: "navigate" }, location)
                }}
              >
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
                  Navigate to path or allowed URL
                  <input
                    className={fieldClass}
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    placeholder="/"
                  />
                </label>
                <Button
                  type="submit"
                  className="self-end"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                >
                  Go
                </Button>
              </form>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
                  CSS selector
                  <input
                    className={fieldClass}
                    value={selector}
                    onChange={(event) => setSelector(event.target.value)}
                    placeholder="#sign-in"
                  />
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || !selector}
                  onClick={() => void act({ type: "click", selector })}
                >
                  Click element
                </Button>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
                  Text to enter
                  <input
                    className={fieldClass}
                    type="password"
                    autoComplete="off"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                  />
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    const value = text
                    setText("")
                    void act(
                      selector
                        ? { type: "fill", selector, value }
                        : { type: "type_text", value }
                    )
                  }}
                >
                  Enter text
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void act({ type: "press", key: "Enter" })}
                >
                  Press Enter
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void act({ type: "press", key: "Tab" })}
                >
                  Press Tab
                </Button>
              </div>
              {currentResult?.pages && currentResult.pages.length > 1 ? (
                <label className="flex flex-col gap-1 text-xs">
                  Browser page
                  <select
                    className={fieldClass}
                    value={session.pageId}
                    disabled={disabled}
                    onChange={(event) =>
                      void act({
                        type: "switch_page",
                        pageId: event.target.value,
                      })
                    }
                  >
                    {currentResult.pages.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.url}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {currentJourney ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs">
                    {currentRequirement?.title} ·{" "}
                    {session.viewport ?? "desktop"} ·{" "}
                    {currentJourney.assertions.length} assertions saved
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={disabled || !nextAssertion}
                    onClick={() => {
                      if (nextAssertion)
                        void act({ type: "assert", assertion: nextAssertion })
                    }}
                  >
                    Verify next assertion
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => void act({ type: "journey_finish" })}
                  >
                    Finish journey
                  </Button>
                  {nextAssertion ? (
                    <p className="w-full text-xs break-words text-muted-foreground">
                      Next: {nextAssertion.type} at {nextAssertion.selector}{" "}
                      must be {String(nextAssertion.value)}.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div aria-live="polite" className="px-3 py-2 text-xs">
            {proof?.policy?.captureMode === "accessibility" ? (
              <p className="mb-2 text-muted-foreground">
                This policy requires DOM proof only. Use page text and selector
                controls; screenshots are not captured.
              </p>
            ) : null}
            {pending ? (
              "Browser action running…"
            ) : error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : (
              (currentResult?.detail ??
              "Start or observe the shared browser to see its current page.")
            )}
          </div>
          {session?.screenshotUrl ? (
            <div className="overflow-auto bg-black/20 p-3">
              <button
                type="button"
                className="mx-auto block max-w-full cursor-crosshair focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default"
                aria-label="Click the observed browser page; keyboard users can use the CSS selector controls"
                disabled={disabled || !controlling}
                onClick={(event) => {
                  if (event.detail === 0) return
                  const box = event.currentTarget.getBoundingClientRect()
                  const picture = event.currentTarget.querySelector("img")
                  if (!picture) return
                  const width = picture.naturalWidth
                  const height = picture.naturalHeight
                  void act({
                    type: "click_point",
                    x: Math.floor(
                      ((event.clientX - box.left) * width) / box.width
                    ),
                    y: Math.floor(
                      ((event.clientY - box.top) * height) / box.height
                    ),
                  })
                }}
              >
                <img
                  className="mx-auto block h-auto max-w-full"
                  src={session.screenshotUrl}
                  alt={`Browser Run page at ${session.viewport ?? "desktop"} viewport, action ${session.sequence}`}
                />
              </button>
            </div>
          ) : null}
          {currentResult?.markdown ? (
            <details
              className="p-3"
              open={proof?.policy?.captureMode === "accessibility"}
            >
              <summary className="cursor-pointer text-xs">
                Observed page controls and text
              </summary>
              <pre className="mt-2 text-xs break-words whitespace-pre-wrap text-muted-foreground">
                {currentResult.markdown}
              </pre>
            </details>
          ) : null}
          {proof?.results.length ? (
            <details className="border-t p-3">
              <summary className="cursor-pointer text-xs">
                Journey attempts and failures
              </summary>
              <ul className="mt-2 space-y-2 text-xs">
                {[...proof.results]
                  .sort((a, b) => b.ordinal - a.ordinal)
                  .slice(0, 30)
                  .map((journey) => (
                    <li key={journey.id} className="break-words">
                      {journey.requirementId} · {journey.status} ·{" "}
                      {journey.binding.commit.slice(0, 7)} / attempt{" "}
                      {journey.binding.attempt} / policy{" "}
                      {journey.binding.policyRevision}: {journey.detail}
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  )
}
