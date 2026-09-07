import { resolveSkillInvocation } from "@workspace/domain"
import type { ThreadEntry } from "@workspace/ui/components/workspace/types"
import type {
  getWorkspace,
  getWorkspaceActivity,
  getWorkspaceChecks,
  getWorkspaceMessages,
} from "@/functions/workspaces"
import {
  applyWorkspaceRuntimeEvent,
  dismissWorkspacePermission,
  emptyWorkspaceLiveState,
} from "@/lib/workspace-runtime-events"
import type { WorkspaceSocket } from "@/lib/workspace-socket"
import {
  createWorkspaceRefreshQueue,
  workspaceRefreshScope,
  type WorkspaceRefreshScope,
} from "./workspace-refresh"
import { workspaceThreadEntries } from "./workspace-thread-entries"

export type WorkspaceSnapshot = Awaited<ReturnType<typeof getWorkspace>>
type MessagePage = Awaited<ReturnType<typeof getWorkspaceMessages>>
type SocketOptions = ConstructorParameters<typeof WorkspaceSocket>[0]
type SocketConnection = Pick<
  WorkspaceSocket,
  "connect" | "close" | "pause" | "resume"
>

export type WorkspaceSynchronizationAdapter = {
  workspace: (workspaceId: string) => Promise<WorkspaceSnapshot>
  runtime: (workspaceId: string) => ReturnType<typeof getWorkspaceActivity>
  checks: (workspaceId: string) => ReturnType<typeof getWorkspaceChecks>
  messages: (workspaceId: string, cursor: string) => Promise<MessagePage>
  socket: (options: SocketOptions) => SocketConnection
}

type OptimisticMessage = {
  id: string
  text: string
  delivery?: "queue" | "steer"
}

type SynchronizationState = {
  result: WorkspaceSnapshot
  live: ReturnType<typeof emptyWorkspaceLiveState>
  presence: Parameters<SocketOptions["onPresence"]>[0]
  page: MessagePage | null
  historyPending: boolean
  historyError: string | null
  refreshError: string | null
  optimisticMessages: ReadonlyArray<OptimisticMessage>
}

const workspaceView = (state: SynchronizationState) => {
  const { result, live, page } = state
  const { runtime } = result
  const matchSkill = (text: string) => {
    const invocation = resolveSkillInvocation(text, result.skills)
    const skill =
      invocation &&
      result.skills.find(
        (candidate) => candidate.metadata.name === invocation.skillId
      )
    return skill && invocation
      ? {
          name: invocation.skillId,
          scope: skill.scope,
          prompt: invocation.text,
        }
      : undefined
  }
  const acknowledged = new Set([
    ...runtime.messages.map((message) => message.id),
    ...runtime.queuedMessages.map((message) => message.id),
  ])
  const optimistic: ThreadEntry[] = state.optimisticMessages
    .filter((message) => !acknowledged.has(message.id))
    .map((message) => ({
      id: `optimistic-${message.id}`,
      kind: "user",
      body: message.text,
      skill: matchSkill(message.text),
      meta:
        message.delivery === "steer"
          ? "You · steering"
          : message.delivery === "queue"
            ? "You · queued"
            : "You",
    }))
  const currentModel = result.models.find(
    (model) => `${model.providerId}/${model.modelId}` === runtime.model
  )
  const models = result.models.map((model) => {
    const available = runtime.availableModels?.find(
      (candidate) =>
        candidate.providerId === model.providerId &&
        candidate.modelId === model.modelId
    )
    return {
      ...model,
      thinkingOptions: available?.thinkingOptions ?? [],
      variants: available?.variants ?? model.variants,
    }
  })
  const permissionRequests = Object.values({
    ...Object.fromEntries(
      runtime.permissions.map((request) => [
        request.id,
        {
          id: request.id,
          action: request.action,
          resources: [...request.resources],
          message: request.message,
          canSave: Boolean(request.save?.length),
        },
      ])
    ),
    ...live.permissionRequests,
  }).filter((request) => !live.dismissedPermissionRequests.includes(request.id))
  return {
    result: {
      ...result,
      models,
      selectedModel: currentModel
        ? {
            providerId: currentModel.providerId,
            modelId: currentModel.modelId,
            variant: runtime.modelVariant,
          }
        : result.selectedModel,
    },
    entries: workspaceThreadEntries(
      {
        ...runtime,
        errorSummary: result.workspace.errorSummary,
        messages: page?.messages ?? runtime.messages,
      },
      page ? { ...live, partialMessages: {} } : live,
      page ? [] : optimistic,
      matchSkill
    ),
    permissionRequests,
    presence: state.presence,
    refreshError: state.refreshError,
    history: {
      viewingOlder: page !== null,
      hasOlder: Boolean(page ? page.cursor : runtime.messagesCursor),
      pending: state.historyPending,
      error: state.historyError,
    },
  }
}

class WorkspaceSynchronization {
  readonly #adapter: WorkspaceSynchronizationAdapter
  readonly #listeners = new Set<() => void>()
  #state: SynchronizationState
  #view: ReturnType<typeof workspaceView>
  #active = false
  #snapshotVersion = 0
  #historyRequest = 0
  #socket: SocketConnection | null = null
  #pollTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    initial: WorkspaceSnapshot,
    adapter: WorkspaceSynchronizationAdapter
  ) {
    this.#adapter = adapter
    this.#state = {
      result: initial,
      live: emptyWorkspaceLiveState(),
      presence: [],
      page: null,
      historyPending: false,
      historyError: null,
      refreshError: null,
      optimisticMessages: [],
    }
    this.#view = workspaceView(this.#state)
  }

  getSnapshot = () => this.#view

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  start = () => {
    if (this.#active) return
    this.#active = true
    this.#publish({ historyPending: false })
    this.#connect()
    this.#schedulePoll()
  }

  stop = () => {
    this.#active = false
    this.#snapshotVersion += 1
    this.#historyRequest += 1
    this.#socket?.close()
    this.#socket = null
    if (this.#pollTimer !== null) clearTimeout(this.#pollTimer)
    this.#pollTimer = null
  }

  pause = () => this.#socket?.pause()
  resume = () => this.#socket?.resume()

  replace = (result: WorkspaceSnapshot) => {
    this.#snapshotVersion += 1
    this.#state = { ...this.#state, refreshError: null }
    this.#accept(result)
  }

  refresh = createWorkspaceRefreshQueue(
    async (scope: WorkspaceRefreshScope) => {
      if (!this.#active) return
      const version = this.#snapshotVersion
      const workspaceId = this.#state.result.workspace.id
      try {
        const update =
          scope === "checks"
            ? { checks: await this.#adapter.checks(workspaceId) }
            : scope === "runtime"
              ? { runtime: await this.#adapter.runtime(workspaceId) }
              : await this.#adapter.workspace(workspaceId)
        if (!this.#active || version !== this.#snapshotVersion) return
        const current = this.#state.result
        this.#state = { ...this.#state, refreshError: null }
        this.#accept({
          ...current,
          ...update,
          models: current.models,
          selectedModel: current.selectedModel,
          modelNotice: current.modelNotice,
          skills: current.skills,
        })
      } catch {
        if (!this.#active || version !== this.#snapshotVersion) return
        this.#publish({
          refreshError:
            "Live updates paused. Reconnect or reload this Workspace.",
        })
      }
    },
    80
  )

  loadOlder = async () => {
    const { page, result, historyPending } = this.#state
    const cursor = page ? page.cursor : result.runtime.messagesCursor
    if (!this.#active || !cursor || historyPending) return
    const request = ++this.#historyRequest
    this.#publish({ historyPending: true, historyError: null })
    try {
      const next = await this.#adapter.messages(result.workspace.id, cursor)
      if (!this.#active || request !== this.#historyRequest) return
      this.#publish({
        page: next.messages.length || !page ? next : { ...page, cursor: null },
      })
    } catch {
      if (this.#active && request === this.#historyRequest)
        this.#publish({
          historyError: "Could not load earlier messages. Try again.",
        })
    } finally {
      if (this.#active && request === this.#historyRequest)
        this.#publish({ historyPending: false })
    }
  }

  showLatest = () => {
    this.#historyRequest += 1
    this.#publish({ page: null, historyPending: false, historyError: null })
  }

  dismissPermissionRequest = (requestId: string) => {
    this.#publish({
      live: dismissWorkspacePermission(this.#state.live, requestId),
    })
  }

  trackPrompt = (id: string, text: string, delivery?: "queue" | "steer") => {
    const message = { id, text, delivery }
    this.#publish({
      optimisticMessages: [
        ...this.#state.optimisticMessages.filter(
          (pending) => pending.id !== id
        ),
        message,
      ],
    })
    return (accepted: boolean) => {
      if (!this.#active || accepted) return
      this.#publish({
        optimisticMessages: this.#state.optimisticMessages.filter(
          (pending) => pending !== message
        ),
      })
    }
  }

  #accept(result: WorkspaceSnapshot) {
    const previous = this.#state.result
    const changed =
      previous.workspace.id !== result.workspace.id ||
      previous.runtime.sessionId !== result.runtime.sessionId
    if (changed) {
      this.#snapshotVersion += 1
      this.#historyRequest += 1
      this.#socket?.close()
      this.#socket = null
      this.#state = {
        ...this.#state,
        live: emptyWorkspaceLiveState(),
        presence: [],
        page: null,
        historyPending: false,
        historyError: null,
        optimisticMessages:
          previous.workspace.id === result.workspace.id &&
          previous.runtime.sessionId === null
            ? this.#state.optimisticMessages
            : [],
      }
    }
    const acknowledged = new Set(
      [...result.runtime.messages, ...result.runtime.queuedMessages].map(
        (message) => message.id
      )
    )
    this.#publish({
      result,
      optimisticMessages: this.#state.optimisticMessages.filter(
        (message) => !acknowledged.has(message.id)
      ),
    })
    if (changed && this.#active) this.#connect()
    this.#schedulePoll()
  }

  #connect() {
    const { workspace, runtime } = this.#state.result
    if (!runtime.sessionId || this.#socket) return
    this.#publish({ live: emptyWorkspaceLiveState(), presence: [] })
    const socket = this.#adapter.socket({
      workspaceId: workspace.id,
      sessionId: runtime.sessionId,
      cursor: runtime.eventCursor,
      onConnecting: () => {
        if (this.#socket !== socket || !this.#active) return
        this.#publish({
          live: { ...this.#state.live, permissionRequests: {} },
        })
      },
      onEvent: async (event) => {
        const live = await applyWorkspaceRuntimeEvent(this.#state.live, event)
        if (this.#socket !== socket || !this.#active) return
        this.#publish({
          live: {
            ...live,
            dismissedPermissionRequests: [
              ...new Set([
                ...this.#state.live.dismissedPermissionRequests,
                ...live.dismissedPermissionRequests,
              ]),
            ],
          },
        })
        const scope = workspaceRefreshScope(event.type)
        if (scope) void this.refresh(scope)
      },
      onSynced: () => {
        if (this.#socket === socket && this.#active)
          void this.refresh("workspace")
      },
      onPresence: (presence) => {
        if (this.#socket === socket && this.#active) this.#publish({ presence })
      },
      onError: (refreshError) => {
        if (this.#socket === socket && this.#active)
          this.#publish({ refreshError })
      },
    })
    this.#socket = socket
    socket.connect()
  }

  #schedulePoll() {
    const { workspace, runtime } = this.#state.result
    const needsPoll =
      workspace.status === "provisioning" ||
      workspace.status === "merging" ||
      runtime.status === "running" ||
      runtime.queuedMessages.length > 0
    if (!this.#active || !needsPoll) {
      if (this.#pollTimer !== null) clearTimeout(this.#pollTimer)
      this.#pollTimer = null
      return
    }
    if (this.#pollTimer !== null) return
    this.#pollTimer = setTimeout(async () => {
      this.#pollTimer = null
      await this.refresh(
        this.#state.result.runtime.status === "running"
          ? "runtime"
          : "workspace"
      )
      this.#schedulePoll()
    }, 2000)
  }

  #publish(update: Partial<SynchronizationState>) {
    this.#state = { ...this.#state, ...update }
    this.#view = workspaceView(this.#state)
    for (const listener of this.#listeners) listener()
  }
}

export const createWorkspaceSynchronization = (
  initial: WorkspaceSnapshot,
  adapter: WorkspaceSynchronizationAdapter
) => new WorkspaceSynchronization(initial, adapter)
