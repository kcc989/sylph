export const latestDeploymentSql =
  "SELECT id, [commit], status, mutation_started FROM deployment WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1"

export const reserveDeploymentSql = `
INSERT INTO deployment (id, project_id, [commit], status, actor_user_id, base_deployment_id, recovery_deployment_id, created_at, updated_at)
SELECT ?, ?, ?, 'queued', ?, ?, ?, ?, ?
WHERE NOT EXISTS (SELECT 1 FROM deployment WHERE project_id = ? AND status IN ('queued', 'running'))
AND (SELECT id FROM deployment WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1) IS ?
`

export const releaseMutationStartedSql =
  "UPDATE deployment SET mutation_started = 1 WHERE id = ? AND project_id = ? AND status = 'running'"

export const releaseContextSql = `
SELECT d.[commit], d.recovery_deployment_id,
  live.[commit] AS base_commit, live.production_url AS base_url,
  r.recovery_json
FROM deployment d
LEFT JOIN deployment live ON live.rowid = (
  SELECT prior.rowid FROM deployment prior
  WHERE prior.project_id = d.project_id AND prior.id != d.id
    AND prior.production_url IS NOT NULL
  ORDER BY prior.created_at DESC, prior.rowid DESC LIMIT 1
)
LEFT JOIN deployment r ON r.id = d.recovery_deployment_id AND r.project_id = d.project_id
WHERE d.id = ? AND d.project_id = ? AND d.status = 'running'
`
