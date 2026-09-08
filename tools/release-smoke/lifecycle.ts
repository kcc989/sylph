import { createHash } from "node:crypto"
import { Schema } from "effect"
import {
  type CombinedSmokeRun,
  type LifecycleObservation,
  type LifecyclePhase,
  type LifecycleProbe,
  type LifecycleScenario,
  lifecyclePaths,
} from "@workspace/domain/lifecycle-proof"

export const approvalPaths = new Set([
  "production-release",
  "deliberate-failure",
  "application-restore",
  "restore-undo",
  "telemetry-repair",
  "partial-failure-cleanup",
])

export const lifecycleDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex")

export function requireLifecycleRun(
  run: CombinedSmokeRun,
  scenario: LifecycleScenario,
  currentCommit: string,
  dirty: boolean
) {
  if (
    run.status !== "deployed" ||
    run.dirty ||
    dirty ||
    run.commit !== currentCommit ||
    scenario.identity.sourceCommit !== run.commit ||
    scenario.identity.templateCommit !== run.template.commit ||
    scenario.identity.stage !== run.stage
  )
    throw new Error(
      "Combined proof source, template, stage or clean checkout does not match"
    )
  const paths = scenario.phases.map((phase) => phase.path)
  if (
    paths.length !== lifecyclePaths.length ||
    new Set(paths).size !== lifecyclePaths.length ||
    lifecyclePaths.some((path) => !paths.includes(path))
  )
    throw new Error("Combined proof requires each lifecycle path exactly once")
  for (const phase of scenario.phases) {
    for (const dependency of phase.dependsOn)
      if (
        dependency === phase.path ||
        paths.indexOf(dependency) >= paths.indexOf(phase.path)
      )
        throw new Error("Phase dependencies must precede the phase")
    for (const probe of phase.probes) requireLifecycleProbe(probe)
  }
}

export function phaseApprovalDigest(
  scenario: LifecycleScenario,
  phase: LifecyclePhase
) {
  return lifecycleDigest(
    JSON.stringify({
      identity: scenario.identity,
      accountId: scenario.accountId,
      options: scenario.options,
      phase,
    })
  )
}

export function requirePhaseApproval(
  scenario: LifecycleScenario,
  phase: LifecyclePhase,
  approvedDigest?: string
) {
  if (
    approvalPaths.has(phase.path) &&
    approvedDigest !== phaseApprovalDigest(scenario, phase)
  )
    throw new Error(
      `Explicit approval required for ${phase.path}: ${phase.target}; digest ${phaseApprovalDigest(scenario, phase)}`
    )
}

export function requireLifecycleProbe(probe: LifecycleProbe) {
  if (probe.select) {
    if (
      !/^d1\/database\/[a-zA-Z0-9_-]+\/query$/.test(probe.path) ||
      !/^SELECT\s/i.test(probe.select.trim()) ||
      /;|--|\/\*|\*\/|\b(load_extension|writefile|readfile)\b/i.test(
        probe.select
      )
    )
      throw new Error("D1 proof probes permit one SELECT query only")
  } else if (
    !/^(workers\/scripts\/[a-zA-Z0-9_-]+\/(settings|deployments)|workflows\/[a-zA-Z0-9_-]+\/instances\/[a-zA-Z0-9_-]+|d1\/database\/[a-zA-Z0-9_-]+)$/.test(
      probe.path
    )
  ) {
    throw new Error(
      "Cloudflare proof probes must read an exact Worker, Workflow instance or D1 database"
    )
  }
}

export function jsonPointer(value: Schema.Json, pointer: string): Schema.Json {
  if (!pointer) return value
  if (!pointer.startsWith("/"))
    throw new Error("Assertion pointer must be empty or start with /")
  let current = value
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~")
    if (Schema.is(Schema.Array(Schema.Json))(current)) {
      const selected = current[Number(segment)]
      if (!/^(0|[1-9][0-9]*)$/.test(segment) || selected === undefined)
        throw new Error("Missing proof assertion array element")
      current = selected
    } else {
      const object = Schema.decodeUnknownSync(Schema.JsonObject)(current)
      if (!Object.hasOwn(object, segment))
        throw new Error("Missing proof assertion field")
      current = object[segment]
    }
  }
  return current
}

export function requireProbeAssertions(
  value: Schema.Json,
  probe: LifecycleProbe
) {
  for (const assertion of probe.assertions)
    if (
      JSON.stringify(jsonPointer(value, assertion.pointer)) !==
      JSON.stringify(assertion.equals)
    )
      throw new Error(`Cloudflare evidence differs at ${assertion.pointer}`)
}

export function combinedLifecycleResult(
  observations: readonly LifecycleObservation[]
) {
  const paths = lifecyclePaths.map((path) => {
    const matching = observations.filter(
      (observation) => observation.path === path
    )
    const last = matching.at(-1)
    const passed =
      last?.outcome === "passed" &&
      last.scope === "deployed" &&
      last.evidence.some((item) => item.kind === "cloudflare-api") &&
      last.evidence.some((item) => item.kind === "browser")
    return {
      path,
      outcome: passed
        ? "passed"
        : last?.outcome === "passed"
          ? "unverified"
          : (last?.outcome ?? "not-run"),
      attempts: matching.length,
    }
  })
  return { complete: paths.every((path) => path.outcome === "passed"), paths }
}
