export interface DurableWorkspaceRuntime {
  evict(): Promise<void>
  initialize(): Promise<void>
}

export type DurableWorkspaceRuntimeFactory = () => DurableWorkspaceRuntime

export type DurableWorkspaceRestartOptions = {
  readonly attempts: number
  readonly delay: () => Promise<void>
}

const defaultRestartOptions: DurableWorkspaceRestartOptions = {
  attempts: 10,
  delay: () => new Promise((resolve) => setTimeout(resolve, 100)),
}

export const restartDurableWorkspace = async (
  runtime: DurableWorkspaceRuntimeFactory,
  options: DurableWorkspaceRestartOptions = defaultRestartOptions
) => {
  await runtime()
    .evict()
    .catch(() => undefined)

  let failure: unknown

  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    try {
      await runtime().initialize()
      return
    } catch (cause) {
      failure = cause
      if (attempt + 1 < options.attempts) {
        await runtime()
          .evict()
          .catch(() => undefined)
        await options.delay()
      }
    }
  }

  throw failure
}
