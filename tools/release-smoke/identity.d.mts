interface TemplateIdentity {
  commit: string
}
interface SmokeIdentityRecord {
  commit: string
  template?: TemplateIdentity
  stage: string
}
interface SmokeIdentity {
  sourceCommit: string
  templateCommit: string
  stage: string
}
export function requireIntegratedSource(
  actual: string,
  expected: string | undefined,
  dirty: boolean,
  template: TemplateIdentity,
  expectedTemplate: string | undefined
): void
export function requireDeployedIdentity(
  identity: SmokeIdentity,
  record: SmokeIdentityRecord
): void
export function requirePublishedTemplate(output: string, commit: string): void
