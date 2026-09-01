export const workspaceVersionControlRequest = () =>
  "https://workspace/vcs?refresh=1"

export const readCurrentProjectHead = <Value>(read: () => Promise<Value>) =>
  read()

export type WorkspaceVersionControlReadOptions = {
  attempts: number
  delay: () => Promise<void>
}

const defaultReadOptions: WorkspaceVersionControlReadOptions = {
  attempts: 100,
  delay: () => new Promise((resolve) => setTimeout(resolve, 100)),
}

export const readWorkspaceVersionControl = async (
  read: () => Promise<Response>,
  options: WorkspaceVersionControlReadOptions = defaultReadOptions
) => {
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    const response = await read()
    if (response.ok) return response

    const failure = new Error(await response.text())
    const initializing = failure.message.includes(
      "Workspace version control is not initialized"
    )
    if (!initializing || attempt + 1 === options.attempts) throw failure

    await options.delay()
  }

  throw new Error("Workspace version control is not initialized")
}
