import {
  DeploymentJourney,
  DeploymentDataRestore,
  DeploymentSafetyFailure,
  DeploymentMigrationReview,
  DeploymentRecoveryPoint,
} from "@workspace/domain"
import { Schema } from "effect"

export const releaseScripts = [
  "sylph:release:review",
  "sylph:release:prepare",
  "sylph:release:restore",
  "sylph:release:verify",
  "sylph:release:resume",
  "sylph:deploy",
] as const

export const releasePreflightCommand = `node -e 'const p=require("./package.json");const missing=${JSON.stringify(releaseScripts)}.filter(s=>!p.scripts?.[s]);if(missing.length){console.error("Release safety requires package scripts: "+missing.join(", "));process.exit(64)}'`

const decodeReleaseJson = <A>(
  schema: Schema.Codec<A, unknown>,
  json: string
): A => {
  try {
    return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(json)
  } catch {
    throw new DeploymentSafetyFailure({
      message: "Invalid release receipt. Check the release safety schema.",
    })
  }
}

const receipt = (output: string, marker: string) => {
  const lines = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${marker}=`))
  if (lines.length !== 1)
    throw new DeploymentSafetyFailure({
      message: `Expected one ${marker} receipt`,
    })
  return lines[0].slice(marker.length + 1)
}

export interface ReleaseIdentity {
  deploymentId: string
  projectId: string
  commit: string
  baseCommit: string | null
}

const assertIdentity = (
  actual: { deploymentId: string; commit: string; baseCommit: string | null },
  expected: ReleaseIdentity
) => {
  if (
    actual.deploymentId !== expected.deploymentId ||
    actual.commit !== expected.commit ||
    actual.baseCommit !== expected.baseCommit
  )
    throw new DeploymentSafetyFailure({
      message:
        "Release receipt does not match the reserved deployment and baseline",
    })
}

export const readMigrationReview = (
  output: string,
  expected: ReleaseIdentity
) => {
  const review = decodeReleaseJson(
    DeploymentMigrationReview,
    receipt(output, "SYLPH_MIGRATION_REVIEW")
  )
  assertIdentity(review, expected)
  return review
}

export const validateRecoveryPoint = (
  point: DeploymentRecoveryPoint,
  now: number
) => {
  if (
    point.capturedAt > now ||
    point.expiresAt <= now ||
    point.expiresAt <= point.capturedAt
  )
    throw new DeploymentSafetyFailure({
      message: "The data recovery point has expired or has invalid timestamps",
    })
  const ids = point.resources.map(
    (resource) => `${resource.kind}:${resource.id}`
  )
  if (new Set(ids).size !== ids.length)
    throw new DeploymentSafetyFailure({
      message: "The data recovery inventory contains duplicate resources",
    })
  for (const resource of point.resources) {
    if (
      resource.restoreVerifiedAt <= 0 ||
      resource.restoreVerifiedAt > point.capturedAt
    )
      throw new DeploymentSafetyFailure({
        message:
          "Each resource requires a verified restore procedure before capture",
      })
  }
  return point
}

export const readRecoveryPoint = (
  output: string,
  expected: ReleaseIdentity,
  now: number
) => {
  const point = decodeReleaseJson(
    DeploymentRecoveryPoint,
    receipt(output, "SYLPH_RECOVERY_POINT")
  )
  assertIdentity(point, expected)
  if (
    point.projectId !== expected.projectId ||
    point.capturedAt < now - 15 * 60_000
  )
    throw new DeploymentSafetyFailure({
      message: "The recovery point belongs to another Project or is not fresh",
    })
  return validateRecoveryPoint(point, now)
}

export const readProductionJourney = (
  output: string,
  expected: ReleaseIdentity,
  url: string
) => {
  const journey = decodeReleaseJson(
    DeploymentJourney,
    receipt(output, "SYLPH_PRODUCTION_JOURNEY")
  )
  if (
    journey.deploymentId !== expected.deploymentId ||
    journey.commit !== expected.commit ||
    journey.url !== url
  )
    throw new DeploymentSafetyFailure({
      message:
        "The production journey did not verify the deployed commit and URL",
    })
  return journey
}

export const decodeRecoveryPoint = (json: string, now: number) =>
  validateRecoveryPoint(decodeReleaseJson(DeploymentRecoveryPoint, json), now)

export const recoveryTargetCommit = (point: DeploymentRecoveryPoint) =>
  point.baseCommit ?? point.commit

export const recoverySummary = (json: string | null) => {
  if (!json) return null
  const point = decodeReleaseJson(DeploymentRecoveryPoint, json)
  return {
    commit: recoveryTargetCommit(point),
    capturedAt: point.capturedAt,
    expiresAt: point.expiresAt,
    resourceCount: point.resources.length,
    available: point.expiresAt > Date.now(),
  }
}

export const readDataRestore = (
  output: string,
  expected: ReleaseIdentity,
  point: DeploymentRecoveryPoint
) => {
  const restored = decodeReleaseJson(
    DeploymentDataRestore,
    receipt(output, "SYLPH_DATA_RESTORED")
  )
  const resources = point.resources
    .map((resource) => `${resource.kind}:${resource.id}`)
    .sort()
  if (
    restored.deploymentId !== expected.deploymentId ||
    restored.recoveryDeploymentId !== point.deploymentId ||
    restored.commit !== expected.commit ||
    JSON.stringify([...restored.resources].sort()) !== JSON.stringify(resources)
  )
    throw new DeploymentSafetyFailure({
      message:
        "Data restore did not cover the selected recovery point and all its resources",
    })
  return restored
}
