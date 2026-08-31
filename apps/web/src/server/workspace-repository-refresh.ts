export const workspaceVersionControlRequest = () =>
  "https://workspace/vcs?refresh=1"

export const readCurrentProjectHead = <Value>(read: () => Promise<Value>) =>
  read()
