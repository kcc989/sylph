const installationId = "default"

export type AccountProvisioningRow = {
  allowed: number
}

export const accountProvisioningQuery = `SELECT CASE
  WHEN claimed_by_user_id IS NULL THEN 1
  WHEN EXISTS (
    SELECT 1
    FROM invitation
    WHERE invitation.organization_id = installation.organization_id
      AND lower(invitation.email) = ?
      AND invitation.status = 'pending'
      AND invitation.expires_at > ?
  ) THEN 1
  ELSE 0
END AS allowed
FROM installation
WHERE installation.id = ?`

export const getAccountProvisioningBindings = (
  email: string,
  now: Date
): [string, number, string] => [
  email.trim().toLocaleLowerCase("en-US"),
  Math.floor(now.getTime() / 1000),
  installationId,
]

export const canProvisionInstallationAccount = async (
  database: D1Database,
  email: string,
  now = new Date()
) => {
  const result = await database
    .prepare(accountProvisioningQuery)
    .bind(...getAccountProvisioningBindings(email, now))
    .first<AccountProvisioningRow>()

  return result?.allowed === 1
}
