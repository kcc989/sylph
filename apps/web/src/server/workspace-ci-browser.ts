export const browserEvidenceSelector = (
  commit: string,
  deployment: "preview" | "production" = "preview"
) =>
  `[data-sylph-checkpoint="${commit}"][data-sylph-deployment="${deployment}"]`
