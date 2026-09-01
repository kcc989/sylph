export interface WorkspacePromptActivation {
  readonly refreshCredential?: () => Promise<void>
  readonly switchModel: () => Promise<void>
}

export const activateWorkspacePrompt = async (
  activation: WorkspacePromptActivation
) => {
  await activation.refreshCredential?.()
  await activation.switchModel()
}
