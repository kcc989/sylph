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
