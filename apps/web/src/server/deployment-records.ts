export const deploymentRunningSql =
  "UPDATE deployment SET status = 'running', started_at = unixepoch(), failure_details = NULL, updated_at = unixepoch() WHERE id = ? AND status IN ('queued', 'running')"

export const deploymentSucceededSql =
  "UPDATE deployment SET status = 'succeeded', production_url = ?, failure_details = NULL, completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND status = 'running' AND review_json IS NOT NULL AND recovery_json IS NOT NULL AND verification_json IS NOT NULL AND (recovery_deployment_id IS NULL OR restore_json IS NOT NULL)"

export const deploymentFailedSql =
  "UPDATE deployment SET status = 'failed', failure_details = ?, completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND status IN ('queued', 'running')"

export const productionUrl = (output: string) =>
  output.match(/SYLPH_PRODUCTION_URL=(https:\/\/[^\s]+)/)?.[1] ?? null

export const deploymentWorkflowAlreadyStarted = (cause: unknown) =>
  cause instanceof Error && cause.message.includes("instance.already_exists")
