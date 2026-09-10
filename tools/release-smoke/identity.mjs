export function requireIntegratedSource(
  actual,
  expected,
  dirty,
  template,
  expectedTemplate
) {
  if (!/^[a-f0-9]{40}$/.test(expected ?? ""))
    throw new Error("Combined proof requires the full integrated source commit")
  if (actual !== expected || dirty)
    throw new Error(
      "Combined proof requires a clean checkout at the exact integrated commit"
    )
  if (
    !/^[a-f0-9]{40}$/.test(expectedTemplate ?? "") ||
    template.commit !== expectedTemplate
  )
    throw new Error(
      "Combined proof requires the exact published template commit"
    )
}

export function requireDeployedIdentity(identity, record) {
  if (
    identity.sourceCommit !== record.commit ||
    identity.templateCommit !== record.template?.commit ||
    identity.stage !== record.stage
  )
    throw new Error(
      "Deployed source, template, or stage identity differs from the run record"
    )
}

export async function waitForDeployedIdentity(
  record,
  request = fetch,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await request(`${record.baseURL}/__sylph/smoke-identity`, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    })
    const body = await response.text()
    if (response.ok && body !== "Alchemy worker is being deployed...") {
      const identity = JSON.parse(body)
      requireDeployedIdentity(identity, record)
      return identity
    }
    if (
      body !== "Alchemy worker is being deployed..." &&
      ![404, 502, 503, 504].includes(response.status)
    )
      throw new Error(`Deployed smoke identity HTTP ${response.status}`)
    if (attempt < 11) await pause(5000)
  }
  throw new Error("Deployed smoke identity did not become ready")
}

export function requirePublishedTemplate(output, commit) {
  const commits = output
    .trim()
    .split("\n")
    .map((line) => line.split(/\s+/)[0])
  if (!commits.length || commits.some((published) => published !== commit))
    throw new Error(
      "The published template ref does not resolve to the expected immutable commit"
    )
}
