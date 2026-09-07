import { Schema } from "effect"

import { WorkspaceBrowserAssertion, WorkspaceBrowserSession } from "./browser"
import { WorkspaceId } from "./ids"
import { GitCommitId } from "./version-control"

const identifier = Schema.NonEmptyString.check(Schema.isMaxLength(120))
const reason = Schema.NonEmptyString.check(Schema.isMaxLength(2_000))
export const BrowserViewport = Schema.Literals(["desktop", "mobile"])
export type BrowserViewport = typeof BrowserViewport.Type
export const browserViewportSize = (viewport: BrowserViewport) =>
  viewport === "mobile"
    ? { width: 390, height: 844 }
    : { width: 1440, height: 900 }

export const BrowserJourneyRequirement = Schema.Struct({
  id: identifier,
  title: Schema.NonEmptyString.check(Schema.isMaxLength(200)),
  assertions: Schema.Array(WorkspaceBrowserAssertion).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(30)
  ),
  viewports: Schema.Array(BrowserViewport).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(2)
  ),
})
export type BrowserJourneyRequirement = typeof BrowserJourneyRequirement.Type

export const BrowserPolicyInput = Schema.Struct({
  requirements: Schema.Array(BrowserJourneyRequirement).check(
    Schema.isMaxLength(20)
  ),
  allowedOrigins: Schema.Array(Schema.NonEmptyString).check(
    Schema.isMaxLength(10)
  ),
  reason,
})
export type BrowserPolicyInput = typeof BrowserPolicyInput.Type

export class BrowserJourneyPolicy extends Schema.Class<BrowserJourneyPolicy>(
  "@sylph/domain/BrowserJourneyPolicy"
)({
  ...BrowserPolicyInput.fields,
  revision: Schema.Int,
  actorUserId: identifier,
  createdAt: Schema.Number,
}) {}

export const BrowserProofBinding = Schema.Struct({
  workspaceId: WorkspaceId,
  conversationId: Schema.NonEmptyString,
  checkId: Schema.NonEmptyString,
  commit: GitCommitId,
  attempt: Schema.Int,
  policyRevision: Schema.Int,
})
export type BrowserProofBinding = typeof BrowserProofBinding.Type

export const browserProofMatches = (
  left: typeof BrowserProofBinding.Encoded,
  right: typeof BrowserProofBinding.Encoded
) =>
  left.workspaceId === right.workspaceId &&
  left.conversationId === right.conversationId &&
  left.checkId === right.checkId &&
  left.commit === right.commit &&
  left.attempt === right.attempt &&
  left.policyRevision === right.policyRevision

export class BrowserJourneyResult extends Schema.Class<BrowserJourneyResult>(
  "@sylph/domain/BrowserJourneyResult"
)({
  id: identifier,
  binding: BrowserProofBinding,
  requirementId: identifier,
  sessionId: Schema.NonEmptyString,
  status: Schema.Literals(["running", "passed", "failed", "interrupted"]),
  startedAt: Schema.Number,
  updatedAt: Schema.Number,
  ordinal: Schema.Int,
  assertions: Schema.Array(
    Schema.Struct({
      viewport: BrowserViewport,
      index: Schema.Int,
      sequence: Schema.Int,
      evidenceIds: Schema.Array(Schema.String),
    })
  ),
  detail: Schema.String,
}) {}

export class BrowserPolicyException extends Schema.Class<BrowserPolicyException>(
  "@sylph/domain/BrowserPolicyException"
)({
  binding: BrowserProofBinding,
  actorUserId: identifier,
  reason,
  createdAt: Schema.Number,
  ordinal: Schema.Int,
}) {}

export class BrowserJourneySnapshot extends Schema.Class<BrowserJourneySnapshot>(
  "@sylph/domain/BrowserJourneySnapshot"
)({
  policy: Schema.NullOr(BrowserJourneyPolicy),
  binding: Schema.NullOr(BrowserProofBinding),
  results: Schema.Array(BrowserJourneyResult),
  exception: Schema.NullOr(BrowserPolicyException),
  session: Schema.NullOr(WorkspaceBrowserSession),
}) {}

export const browserJourneyBlockers = (
  proof: typeof BrowserJourneySnapshot.Encoded | undefined,
  expected: Omit<typeof BrowserProofBinding.Encoded, "policyRevision">
) => {
  if (!proof?.policy || !proof.binding)
    return [
      "Set a browser journey policy, then complete its journeys or record a policy exception.",
    ]
  const binding = { ...expected, policyRevision: proof.policy.revision }
  if (!browserProofMatches(proof.binding, binding))
    return [
      "Browser journey proof is stale for this Workspace, Conversation, Check attempt, or commit.",
    ]
  const current = proof.results.filter((result) =>
    browserProofMatches(result.binding, binding)
  )
  const exception = proof.exception
  if (
    exception &&
    browserProofMatches(exception.binding, binding) &&
    current.every((result) => result.ordinal < exception.ordinal)
  )
    return []
  const blockers: string[] = []
  if (!proof.policy.requirements.length)
    blockers.push(
      "The browser policy has no required journeys. Record an explicit policy exception for this Check attempt."
    )
  for (const requirement of proof.policy.requirements) {
    const result = current
      .filter((item) => item.requirementId === requirement.id)
      .sort((a, b) => b.ordinal - a.ordinal)[0]
    const complete =
      result &&
      requirement.viewports.every((viewport) =>
        requirement.assertions.every((_, index) =>
          result.assertions.some(
            (assertion) =>
              assertion.viewport === viewport &&
              assertion.index === index &&
              assertion.evidenceIds.length > 0
          )
        )
      )
    if (!result || result.status !== "passed" || !complete)
      blockers.push(
        `${requirement.title}: ${result?.status === "passed" && !complete ? "incomplete" : (result?.status ?? "missing")} browser journey proof.`
      )
  }
  for (const result of current) {
    if (
      result.requirementId === "exploratory" &&
      result.status !== "passed" &&
      !current.some(
        (later) =>
          later.requirementId !== "exploratory" &&
          later.status === "passed" &&
          later.ordinal > result.ordinal
      )
    )
      blockers.push(
        "An exploratory browser action failed or was interrupted. Complete a required journey after this failure or record a policy exception."
      )
  }
  return blockers
}

export const WorkspaceBrowserPolicyInput = Schema.Struct({
  workspaceId: WorkspaceId,
  expectedRevision: Schema.Int,
  policy: BrowserPolicyInput,
})
export const WorkspaceBrowserExceptionInput = Schema.Struct({
  workspaceId: WorkspaceId,
  binding: BrowserProofBinding,
  reason,
})

export const WorkspaceBrowserAcceptanceInput = Schema.Struct({
  workspaceId: WorkspaceId,
  binding: BrowserProofBinding,
})
