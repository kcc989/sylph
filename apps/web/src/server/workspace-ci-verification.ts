import type { WorkspaceCheckStageName } from "@workspace/domain"

export const verificationStageNames = [
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

export const verificationCommand = (
  stages: ReadonlyArray<VerificationStageCommand>
) =>
  stages
    .flatMap(({ name, command }) => [
      stageMarker("STARTED", name),
      `if (${command}); then`,
      stageMarker("PASSED", name),
      "else",
      "sylph_stage_status=$?",
      stageMarker("FAILED", name),
      'exit "$sylph_stage_status"',
      "fi",
    ])
    .join("\n")

const markerPattern =
  /^SYLPH_STAGE_(STARTED|PASSED|FAILED)=(typecheck|lint|test|build):(\d+)$/gm

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
