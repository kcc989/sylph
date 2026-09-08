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
