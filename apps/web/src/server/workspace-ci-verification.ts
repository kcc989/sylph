import type {
  WorkspaceCheckStage,
  WorkspaceCheckStageName,
} from "@workspace/domain"
import { checkStage } from "./workspace-checks"

export const verificationStageNames = [
  "install",
  "typecheck",
  "lint",
  "test",
  "build",
] as const satisfies ReadonlyArray<WorkspaceCheckStageName>

type VerificationStageName = (typeof verificationStageNames)[number]

export const isVerificationStageName = (
  value: string
): value is VerificationStageName =>
  verificationStageNames.some((name) => name === value)

type VerificationStageCommand = {
  readonly name: VerificationStageName
  readonly command: string
}

const stageMarker = (
  state: "STARTED" | "PASSED" | "FAILED",
  name: VerificationStageName
) => `node -e 'console.log("SYLPH_STAGE_${state}=${name}:" + Date.now())'`

const stageCommand = ({ name, command }: VerificationStageCommand) =>
  [
    stageMarker("STARTED", name),
    `if (${command}); then`,
    stageMarker("PASSED", name),
    "else",
    "sylph_stage_status=$?",
    stageMarker("FAILED", name),
    'exit "$sylph_stage_status"',
    "fi",
  ].join("\n")

export const verificationCommand = (
  stages: ReadonlyArray<VerificationStageCommand>,
  concurrency: 1 | 2 = 2
) => {
  const batches: VerificationStageCommand[][] = []
  for (const stage of stages) {
    const previous = batches.at(-1)
    const parallel = stage.name === "lint" || stage.name === "typecheck"
    if (
      parallel &&
      previous &&
      previous.length < concurrency &&
      previous.every(
        (item) => item.name === "lint" || item.name === "typecheck"
      )
    )
      previous.push(stage)
    else batches.push([stage])
  }
  return [
    "sylph_logs=$(mktemp -d)",
    `trap 'rm -rf "$sylph_logs"' EXIT`,
    ...batches.flatMap((batch) => [
      ...batch.flatMap((stage) => [
        `(${stageCommand(stage)}) >"$sylph_logs/${stage.name}.out" 2>"$sylph_logs/${stage.name}.err" &`,
        `sylph_pid_${stage.name}=$!`,
      ]),
      "sylph_batch_status=0",
      ...batch.flatMap((stage) => [
        `wait "$sylph_pid_${stage.name}" || sylph_batch_status=$?`,
        `cat "$sylph_logs/${stage.name}.out"`,
        `cat "$sylph_logs/${stage.name}.err" >&2`,
      ]),
      '[ "$sylph_batch_status" -eq 0 ] || exit "$sylph_batch_status"',
    ]),
  ].join("\n")
}

const markerPattern =
  /^SYLPH_STAGE_(STARTED|PASSED|FAILED)=(install|typecheck|lint|test|build):(\d+)$/gm

const isVerificationState = (
  value: string | undefined
): value is "STARTED" | "PASSED" | "FAILED" =>
  value === "STARTED" || value === "PASSED" || value === "FAILED"

const verificationMarkers = (output: string) =>
  [...output.matchAll(markerPattern)].flatMap((match) => {
    const state = match[1]
    const name = match[2]
    const timestamp = match[3]
    if (
      !isVerificationState(state) ||
      name === undefined ||
      !isVerificationStageName(name) ||
      timestamp === undefined
    ) {
      return []
    }
    return [{ state, name, at: Number(timestamp) }]
  })

export const verificationDurations = (output: string) => {
  const started = new Map<VerificationStageName, number>()
  const durations = new Map<VerificationStageName, number>()
  for (const marker of verificationMarkers(output)) {
    if (marker.state === "STARTED") started.set(marker.name, marker.at)
    if (marker.state === "PASSED") {
      const startedAt = started.get(marker.name)
      if (startedAt !== undefined)
        durations.set(marker.name, marker.at - startedAt)
    }
  }
  return durations
}

export const verificationFailureStage = (output: string) => {
  const markers = verificationMarkers(output)
  for (let index = markers.length - 1; index >= 0; index -= 1) {
    const marker = markers[index]
    if (marker?.state === "FAILED") return marker.name
  }
  return undefined
}

export const verificationConcurrency = (configured?: string): 1 | 2 => {
  if (!configured || configured === "2") return 2
  if (configured === "1") return 1
  throw new Error("CI_VERIFICATION_CONCURRENCY must be 1 or 2")
}

export const verificationFailureStages = (output: string) => [
  ...new Set(
    verificationMarkers(output)
      .filter((marker) => marker.state === "FAILED")
      .map((marker) => marker.name)
  ),
]

export const failedCheckStages = (
  stages: ReadonlyArray<WorkspaceCheckStage>,
  output: string,
  failedNames: ReadonlySet<WorkspaceCheckStageName>
) => {
  const durations = verificationDurations(output)
  return stages.map((stage) => {
    if (failedNames.has(stage.name))
      return checkStage(stage.name, "failed", "Failed", stage.durationMs)
    const duration = isVerificationStageName(stage.name)
      ? durations.get(stage.name)
      : undefined
    if (duration !== undefined)
      return checkStage(
        stage.name,
        "passed",
        "Passed before Check failed",
        duration
      )
    if (stage.status === "passed" || stage.status === "failed") return stage
    return checkStage(
      stage.name,
      "skipped",
      "Not completed because Check failed"
    )
  })
}
