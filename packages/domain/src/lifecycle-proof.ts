import { Schema } from "effect"

export const LifecycleCommit = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{40}$/)
)
export const LifecycleStage = Schema.String.check(
  Schema.isPattern(/^smoke-[a-z0-9-]{1,45}$/)
)

export const DeployedSmokeIdentity = Schema.Struct({
  sourceCommit: LifecycleCommit,
  templateCommit: LifecycleCommit,
  stage: LifecycleStage,
})
export type DeployedSmokeIdentity = typeof DeployedSmokeIdentity.Type

export const lifecyclePaths = [
  "fresh-setup",
  "model-native-commands",
  "checks",
  "authenticated-preview",
  "acceptance",
  "production-release",
  "deliberate-failure",
  "application-restore",
  "restore-undo",
  "telemetry-repair",
  "concurrent-previews",
  "ownership-conflict",
  "partial-failure-cleanup",
] as const

export const LifecyclePath = Schema.Literals(lifecyclePaths)
export type LifecyclePath = typeof LifecyclePath.Type

export const LifecycleObservation = Schema.Struct({
  path: LifecyclePath,
  phaseDigest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  identity: DeployedSmokeIdentity,
  observedAt: Schema.String,
  outcome: Schema.Literals(["passed", "failed", "blocked", "not-run"]),
  scope: Schema.Literals(["deployed", "local-fixture"]),
  detail: Schema.NonEmptyString,
  evidence: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals([
        "cloudflare-api",
        "browser",
        "workflow",
        "source",
        "local-fixture",
      ]),
      file: Schema.NonEmptyString,
      sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    })
  ),
})
export type LifecycleObservation = typeof LifecycleObservation.Type

export const CombinedSmokeRun = Schema.Struct({
  stage: LifecycleStage,
  commit: LifecycleCommit,
  dirty: Schema.Boolean,
  auth: Schema.Literals(["magic", "github"]),
  status: Schema.String,
  baseURL: Schema.String,
  environmentPath: Schema.String,
  template: Schema.Struct({
    repository: Schema.String,
    commit: LifecycleCommit,
    version: Schema.String,
  }),
})
export type CombinedSmokeRun = typeof CombinedSmokeRun.Type

export const LifecycleProbe = Schema.Struct({
  path: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_/?=&.-]+$/)),
  select: Schema.optional(Schema.String),
  assertions: Schema.Array(
    Schema.Struct({ pointer: Schema.String, equals: Schema.Json })
  ).check(Schema.isMinLength(1)),
})
export type LifecycleProbe = typeof LifecycleProbe.Type

export const LifecyclePhase = Schema.Struct({
  path: LifecyclePath,
  target: Schema.NonEmptyString,
  action: Schema.String.check(
    Schema.isPattern(/^tests\/release-smoke\/actions\/[a-z0-9-]+\.ts$/)
  ),
  actionSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  timeoutSeconds: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(1800)
  ),
  dependsOn: Schema.Array(LifecyclePath),
  probes: Schema.Array(LifecycleProbe).check(Schema.isMinLength(1)),
})
export type LifecyclePhase = typeof LifecyclePhase.Type

export const LifecycleActionOptions = Schema.Struct({
  organizationName: Schema.NonEmptyString,
  projectName: Schema.NonEmptyString,
  modelName: Schema.Literal("Grok 4.6"),
  appEmail: Schema.NonEmptyString,
  cleanupScope: Schema.optional(
    Schema.String.check(Schema.isPattern(/^preview:[a-zA-Z0-9-]+:[0-9]+$/))
  ),
})
export type LifecycleActionOptions = typeof LifecycleActionOptions.Type

export const LifecycleScenario = Schema.Struct({
  identity: DeployedSmokeIdentity,
  accountId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/)),
  modelBudgetUsd: Schema.Literal(4),
  modelWorkspaceLimit: Schema.Literal(2),
  options: Schema.optional(LifecycleActionOptions),
  phases: Schema.Array(LifecyclePhase),
})
export type LifecycleScenario = typeof LifecycleScenario.Type

export const LifecycleBrowserEvidence = Schema.Struct({
  identity: DeployedSmokeIdentity,
  path: LifecyclePath,
  scope: Schema.Literal("deployed"),
  authenticated: Schema.Boolean,
  checkpoint: Schema.NullOr(LifecycleCommit),
  assertions: Schema.Array(
    Schema.Struct({
      name: Schema.NonEmptyString,
      expected: Schema.Json,
      observed: Schema.Json,
    })
  ).check(Schema.isMinLength(1)),
})
