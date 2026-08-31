type PreviewRequest = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
) => Promise<Response>

export const previewRetention = (configuredSeconds?: string) => {
  if (!configuredSeconds) return "7 days" as const
  const seconds = Number(configuredSeconds)
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("Preview retention seconds must be a non-negative number")
  }
  return seconds
}

export const previewWorkerName = (previewUrl: string) => {
  const hostname = new URL(previewUrl).hostname
  if (!hostname.endsWith(".workers.dev")) {
    throw new Error("Preview cleanup requires a workers.dev URL")
  }
  const worker = hostname.split(".")[0]
  if (!worker) throw new Error("Preview Worker name is missing")
  return worker
}

export const removePreviewWorker = async (
  input: { accountId: string; token: string; previewUrl: string },
  request: PreviewRequest = fetch
) => {
  const worker = previewWorkerName(input.previewUrl)
  const response = await request(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(input.accountId)}/workers/scripts/${encodeURIComponent(worker)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${input.token}` },
    }
  )
  if (!response.ok && response.status !== 404) {
    throw new Error(`Preview cleanup failed with HTTP ${response.status}`)
  }
}
