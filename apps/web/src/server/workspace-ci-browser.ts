export const browserEvidenceSelector = (commit: string) =>
  `[data-sylph-checkpoint="${commit}"][data-sylph-deployment="preview"]`
