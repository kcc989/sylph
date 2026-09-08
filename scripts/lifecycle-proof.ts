import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parseArgs, parseEnv } from "node:util"
import { Schema } from "effect"
import {
  LifecycleActionOptions,
  CombinedSmokeRun,
  DeployedSmokeIdentity,
  LifecycleBrowserEvidence,
  LifecycleObservation,
  LifecycleScenario,
} from "@workspace/domain/lifecycle-proof"
import {
  combinedLifecycleResult,
  lifecycleDigest,
  phaseApprovalDigest,
  requireLifecycleRun,
  requirePhaseApproval,
  requireProbeAssertions,
  jsonPointer,
} from "../tools/release-smoke/lifecycle"

import { createLifecycleScenario } from "../tools/release-smoke/lifecycle-scenario"
import {
  LifecycleActionState,
  LifecycleProviderEvidence,
} from "@workspace/domain/lifecycle-actions"

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    run: { type: "string" },
    scenario: { type: "string" },
    phase: { type: "string" },
    options: { type: "string" },
    "account-id": { type: "string" },
    "approval-digest": { type: "string" },
  },
})
const root = resolve(import.meta.dirname, "..")

function git(...args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" })
  if (result.status !== 0) throw new Error("Git source verification failed")
  return result.stdout.trim()
}

async function main() {
  const command = positionals[0]
  if (
    !values.run ||
    !values.scenario ||
    !["create", "prepare", "run", "report"].includes(command ?? "")
  )
    throw new Error(
      "Use create|prepare|run|report --run run.json --scenario scenario.json; create requires --options and --account-id; run requires --phase"
    )
  const run = Schema.decodeUnknownSync(CombinedSmokeRun)(
    JSON.parse(await readFile(values.run, "utf8"))
  )
  if (command === "create") {
    if (!values.options || !values["account-id"])
      throw new Error(
        "create requires --options options.json and --account-id ACCOUNT_ID"
      )
    const options = Schema.decodeUnknownSync(LifecycleActionOptions)(
      JSON.parse(await readFile(values.options, "utf8"))
    )
    const scenario = await createLifecycleScenario(
      root,
      run,
      values["account-id"],
      options
    )
    await writeFile(values.scenario, JSON.stringify(scenario, null, 2), {
      mode: 0o600,
      flag: "wx",
    })
    console.log(
      `Prepared twelve concrete actions in ${resolve(values.scenario)}. No provider request or mutation was made.`
    )
    return
  }
  const scenario = Schema.decodeUnknownSync(LifecycleScenario)(
    JSON.parse(await readFile(values.scenario, "utf8"))
  )
  requireLifecycleRun(
    run,
    scenario,
    git("rev-parse", "HEAD"),
    Boolean(git("status", "--porcelain"))
  )
  const directory = resolve(root, ".alchemy/smoke-runs", run.stage, "lifecycle")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const observations = []
  for (const name of (await readdir(directory))
    .filter((name) => name.endsWith(".observation.json"))
    .sort())
    observations.push(
      Schema.decodeUnknownSync(LifecycleObservation)(
        JSON.parse(await readFile(resolve(directory, name), "utf8"))
      )
    )
  for (const observation of observations) {
    const phase = scenario.phases.find(
      (candidate) => candidate.path === observation.path
    )
    if (
      !phase ||
      observation.phaseDigest !== phaseApprovalDigest(scenario, phase) ||
      JSON.stringify(observation.identity) !== JSON.stringify(scenario.identity)
    )
      throw new Error(
        "Saved observation belongs to a different phase, target or source"
      )
    for (const evidence of observation.evidence) {
      const file = resolve(evidence.file)
      if (
        !file.startsWith(`${directory}/`) ||
        lifecycleDigest(await readFile(file, "utf8")) !== evidence.sha256
      )
        throw new Error(
          "Saved lifecycle evidence is missing, outside this run, or changed"
        )
    }
  }
  if (command === "report") {
    const result = combinedLifecycleResult(observations)
    console.log(
      JSON.stringify({ identity: scenario.identity, ...result }, null, 2)
    )
    if (!result.complete) process.exitCode = 1
    return
  }
  for (const phase of scenario.phases) {
    git("ls-files", "--error-unmatch", "--", phase.action)
    if (
      lifecycleDigest(await readFile(resolve(root, phase.action), "utf8")) !==
      phase.actionSha256
    )
      throw new Error(`Action source digest differs: ${phase.path}`)
  }
  const statePath = resolve(directory, "state.json")
  const observedState = existsSync(statePath)
    ? Schema.decodeUnknownSync(LifecycleActionState)(
        JSON.parse(await readFile(statePath, "utf8"))
      )
    : null
  const last = [...observations]
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
    .at(-1)
  const stateEvidence = last?.evidence.find((entry) => entry.kind === "source")
  if (
    stateEvidence &&
    lifecycleDigest(await readFile(statePath, "utf8")) !== stateEvidence.sha256
  )
    throw new Error("Observed lifecycle state changed outside the prior action")
  if (command === "prepare") {
    console.log(
      JSON.stringify(
        {
          identity: scenario.identity,
          accountId: scenario.accountId,
          modelBudgetUsdPerWorkspace: scenario.modelBudgetUsd,
          modelWorkspaceLimit: scenario.modelWorkspaceLimit,
          maximumModelBudgetUsd:
            scenario.modelBudgetUsd * scenario.modelWorkspaceLimit,
          observedState,
          phases: scenario.phases.map((phase) => ({
            ...phase,
            approvalDigest: phaseApprovalDigest(scenario, phase),
          })),
        },
        null,
        2
      )
    )
    return
  }
  const phase = scenario.phases.find(
    (candidate) => candidate.path === values.phase
  )
  if (!phase) throw new Error("Select an exact scenario phase")
  requirePhaseApproval(scenario, phase, values["approval-digest"])
  if (observations.some((observation) => observation.path === phase.path))
    throw new Error(
      "This phase already has an attempt; preserve its evidence and review the failure before any new run"
    )
  const results = combinedLifecycleResult(observations)
  if (
    phase.dependsOn.some(
      (dependency) =>
        !results.paths.some(
          (path) => path.path === dependency && path.outcome === "passed"
        )
    )
  )
    throw new Error("Required lifecycle phases are not verified")
  const saved = parseEnv(await readFile(run.environmentPath, "utf8"))
  if (
    saved.CLOUDFLARE_ACCOUNT_ID !== scenario.accountId ||
    !saved.CLOUDFLARE_API_TOKEN
  )
    throw new Error(
      "Saved run configuration does not match the scenario Cloudflare account"
    )
  if (saved.SYLPH_SMOKE_GROK_BUDGET !== "true")
    throw new Error(
      "Model generation requires the persisted bounded smoke budget"
    )
  const identityResponse = await fetch(
    `${run.baseURL}/__sylph/smoke-identity`,
    { redirect: "error", signal: AbortSignal.timeout(30_000) }
  )
  if (!identityResponse.ok)
    throw new Error("Deployed source identity is unavailable")
  const identity = Schema.decodeUnknownSync(DeployedSmokeIdentity)(
    await identityResponse.json()
  )
  if (JSON.stringify(identity) !== JSON.stringify(scenario.identity))
    throw new Error("Deployed source identity differs from the scenario")
  const attemptDirectory = resolve(directory, phase.path)
  await mkdir(attemptDirectory, { mode: 0o700 })
  let observation: LifecycleObservation = {
    path: phase.path,
    phaseDigest: phaseApprovalDigest(scenario, phase),
    identity,
    observedAt: new Date().toISOString(),
    outcome: "failed",
    scope: "deployed",
    detail: "Phase did not finish",
    evidence: [],
  }
  const observationPath = resolve(directory, `${phase.path}.observation.json`)
  await writeFile(observationPath, JSON.stringify(observation), {
    flag: "wx",
    mode: 0o600,
  })
  try {
    const result = spawnSync("bun", [phase.action], {
      cwd: root,
      env: {
        ...process.env,
        ...saved,
        SYLPH_SMOKE_BASE_URL: run.baseURL,
        SYLPH_SMOKE_AUTH_MODE: run.auth,
        SYLPH_LIFECYCLE_SCENARIO: resolve(values.scenario),
        SYLPH_LIFECYCLE_PHASE: phase.path,
        SYLPH_LIFECYCLE_OUTPUT: attemptDirectory,
      },
      encoding: "utf8",
      timeout: phase.timeoutSeconds * 1000,
      maxBuffer: 32 * 1024 * 1024,
    })
    await writeFile(
      resolve(attemptDirectory, "action.log"),
      `${result.stdout ?? ""}${result.stderr ?? ""}`,
      { mode: 0o600 }
    )
    if (result.status !== 0) {
      try {
        const failure = Schema.decodeUnknownSync(
          Schema.Struct({
            outcome: Schema.Literals(["blocked", "failed"]),
            message: Schema.String,
          })
        )(
          JSON.parse(
            await readFile(resolve(attemptDirectory, "failure.json"), "utf8")
          )
        )
        observation = {
          ...observation,
          outcome: failure.outcome,
          detail: failure.message,
        }
      } catch {
        observation = {
          ...observation,
          detail: "Phase process failed; inspect the private action log",
        }
      }
      throw new Error(observation.detail)
    }
    const providerFile = resolve(attemptDirectory, "provider.json")
    const providerText = await readFile(providerFile, "utf8")
    const provider = Schema.decodeUnknownSync(LifecycleProviderEvidence)(
      JSON.parse(providerText)
    )
    if (
      provider.path !== phase.path ||
      JSON.stringify(provider.identity) !== JSON.stringify(identity) ||
      provider.assertions.some(
        (assertion) =>
          JSON.stringify(assertion.observed) !==
          JSON.stringify(assertion.expected)
      )
    )
      throw new Error("Action provider observations did not verify this phase")
    observation = {
      ...observation,
      evidence: [
        {
          kind: "cloudflare-api",
          file: providerFile,
          sha256: lifecycleDigest(providerText),
        },
      ],
    }

    const browserFile = resolve(attemptDirectory, "browser.json")
    const browserText = await readFile(browserFile, "utf8")
    const browser = Schema.decodeUnknownSync(LifecycleBrowserEvidence)(
      JSON.parse(browserText)
    )
    if (
      browser.path !== phase.path ||
      JSON.stringify(browser.identity) !== JSON.stringify(identity) ||
      !browser.authenticated ||
      (!["fresh-setup", "model-native-commands"].includes(phase.path) &&
        browser.checkpoint === null) ||
      browser.assertions.some(
        (assertion) =>
          JSON.stringify(assertion.observed) !==
          JSON.stringify(assertion.expected)
      )
    )
      throw new Error(
        "Authenticated browser assertions did not verify this phase and source"
      )
    observation = {
      ...observation,
      evidence: [
        ...observation.evidence,
        {
          kind: "browser",
          file: browserFile,
          sha256: lifecycleDigest(browserText),
        },
      ],
    }
    for (const [index, probe] of phase.probes.entries()) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${scenario.accountId}/${probe.path}`,
        {
          method: probe.select ? "POST" : "GET",
          headers: {
            Authorization: `Bearer ${saved.CLOUDFLARE_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: probe.select
            ? JSON.stringify({ sql: probe.select })
            : undefined,
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        }
      )
      if (!response.ok)
        throw new Error(`Cloudflare probe failed (HTTP ${response.status})`)
      const text = await response.text()
      const file = resolve(attemptDirectory, `cloudflare-${index}.json`)
      await writeFile(file, text, { mode: 0o600 })
      const decoded = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text))
      if (jsonPointer(decoded, "/success") !== true)
        throw new Error("Cloudflare returned an unsuccessful proof response")
      requireProbeAssertions(decoded, probe)
      observation = {
        ...observation,
        evidence: [
          ...observation.evidence,
          {
            kind: "cloudflare-api",
            file,
            sha256: lifecycleDigest(text),
          },
        ],
      }
    }
    const stateFile = resolve(attemptDirectory, "state-after.json")
    const stateText = await readFile(stateFile, "utf8")
    observation = {
      ...observation,
      evidence: [
        ...observation.evidence,
        { kind: "source", file: stateFile, sha256: lifecycleDigest(stateText) },
      ],
      outcome: "passed",
      detail: `Verified ${phase.target}`,
    }
  } finally {
    await writeFile(observationPath, JSON.stringify(observation, null, 2), {
      mode: 0o600,
    })
  }
  console.log(JSON.stringify(observation, null, 2))
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Combined lifecycle proof failed"
  )
  process.exitCode = 1
})
