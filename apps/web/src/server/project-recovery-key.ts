export const projectRecoveryKey = async (
  projectId: string,
  installationKey: string
) => {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(installationKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(JSON.stringify(["sylph-project-recovery-v1", projectId]))
  )
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

export const projectRecoveryVerifyToken = async (
  projectId: string,
  installationKey: string
) =>
  projectRecoveryKey(
    JSON.stringify(["verification", projectId]),
    installationKey
  )
