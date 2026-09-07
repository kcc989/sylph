import { afterEach, expect, test } from "bun:test"
import { WorkspaceRuntimeEvent } from "@workspace/domain"
import {
  createWorkspaceSynchronization,
  type WorkspaceSnapshot,
  type WorkspaceSynchronizationAdapter,
} from "./workspace-synchronization"

type SocketOptions = Parameters<WorkspaceSynchronizationAdapter["socket"]>[0]

class TestSocket {
  connected = 0
  closed = 0
  paused = 0
  resumed = 0
  constructor(readonly options: SocketOptions) {}
  connect() {
    this.connected += 1
    this.options.onConnecting()
  }
  close() {
    this.closed += 1
  }
  pause() {
    this.paused += 1
  }
  resume() {
    this.resumed += 1
  }
}

const snapshot = (
  workspaceId = "workspace-1",
  sessionId: string | null = "session-1"
): WorkspaceSnapshot => ({
  workspace: {
    id: workspaceId,
    projectId: "project-1",
    projectName: "Project",
    projectSlug: "project",
    organizationId: "organization-1",
    organizationName: "Organization",
    organizationSlug: "organization",
    title: "Workspace",
    status: "ready",
    repositoryName: "project-repository",
    repositoryRemote: "https://example.com/project",
    workspaceRepositoryName: "workspace-repository",
    defaultBranch: "main",
    importOriginUrl: null,
    importOriginBranch: null,
    upstreamHead: null,
    upstreamStatus: "disconnected",
    upstreamSyncedAt: null,
    deliveryMode: "push",
    deliveredCommit: null,
    deliveryUrl: null,
    baseCommit: null,
    forkHead: null,
    syncStatus: "ready",
    mergeStatus: "idle",
    errorSummary: null,
    acceptedCommit: null,
  },
  runtime: {
    workspaceId,
    sessionId,
    eventCursor: 10,
    status: sessionId ? "ready" : "provisioning",
    model: null,
    files: [],
    messages: [],
    messagesCursor: "older",
    queuedMessages: [],
    questions: [],
    permissions: [],
    lastTurnOutcome: null,
    activeTurnStartedAt: null,
    limits: {
      maxQueuedMessages: 5,
      maxTurnDurationMs: 900000,
      maxCheckAttempts: 3,
      maxCheckContinuations: 3,
    },
    checkContinuationsUsed: 0,
    archivedAt: null,
    opencode: { healthy: true },
  },
  versionControl: null,
  workingRevision: 0,
  checkpoints: [],
  checks: [],
  review: null,
  currentReviewer: { id: "user", name: "User", image: null },
  models: [],
  selectedModel: null,
  modelNotice: null,
  skills: [],
})

const active = new Set<ReturnType<typeof createWorkspaceSynchronization>>()
afterEach(() => {
  for (const sync of active) sync.stop()
  active.clear()
})

const setup = (initial = snapshot()) => {
  const sockets: TestSocket[] = []
  const adapter: WorkspaceSynchronizationAdapter = {
    workspace: async () => initial,
    runtime: async () => initial.runtime,
    checks: async () => initial.checks,
    messages: async () => ({ messages: [], cursor: null }),
    socket: (options) => {
      const socket = new TestSocket(options)
      sockets.push(socket)
      return socket
    },
  }
  const sync = createWorkspaceSynchronization(initial, adapter)
  active.add(sync)
  sync.start()
  return { sync, adapter, sockets }
}

const deferred = <T>() => {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise not initialized")
  }
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const message = (
  id: string,
  text: string
): WorkspaceSnapshot["runtime"]["messages"][number] => ({
  id,
  role: "user",
  createdAt: 1,
  parts: [{ type: "text", text }],
  error: null,
})
const delta = (text: string) =>
  new WorkspaceRuntimeEvent({
    id: crypto.randomUUID(),
    created: 1,
    type: "session.text.delta",
    data: {
      sessionID: "session-1",
      assistantMessageID: "assistant-1",
      delta: text,
    },
  })

const permission = {
  id: "permission-1",
  sessionID: "session-1",
  action: "write",
  resources: ["README.md"],
  save: ["README.md"],
}

test("history is a read view while live messages and optimistic prompts keep updating", async () => {
  const { sync, adapter, sockets } = setup()
  adapter.messages = async () => ({
    messages: [message("old", "Earlier")],
    cursor: null,
  })
  const finish = sync.trackPrompt("pending", "Next task")
  await sockets[0].options.onEvent(delta("Hel"))
  await sync.loadOlder()
  await sockets[0].options.onEvent(delta("lo"))
  expect(sync.getSnapshot().entries.map((entry) => entry.body)).toEqual([
    "Earlier",
  ])
  expect(sync.getSnapshot().history.viewingOlder).toBeTrue()
  sync.showLatest()
  expect(sync.getSnapshot().entries.map((entry) => entry.body)).toEqual([
    "Next task",
    "Hello",
  ])
  finish(false)
  expect(sync.getSnapshot().entries.map((entry) => entry.body)).toEqual([
    "Hello",
  ])
})

test("session replacement resets history, Presence, and the socket cursor together", async () => {
  const { sync, adapter, sockets } = setup()
  const page =
    deferred<Awaited<ReturnType<WorkspaceSynchronizationAdapter["messages"]>>>()
  adapter.messages = () => page.promise
  const loading = sync.loadOlder()
  const old = sockets[0]
  old.options.onPresence([{ userId: "old-user", name: "Old", connections: 1 }])
  await old.options.onEvent(delta("Old text"))
  const next = snapshot("workspace-1", "session-2")
  next.runtime = { ...next.runtime, eventCursor: 2 }
  sync.replace(next)
  page.resolve({ messages: [message("old", "Stale history")], cursor: null })
  await loading
  await old.options.onEvent(delta("Late text"))
  old.options.onPresence([{ userId: "old-user", name: "Old", connections: 1 }])
  expect(old.closed).toBe(1)
  expect(sockets[1].options.sessionId).toBe("session-2")
  expect(sockets[1].options.cursor).toBe(2)
  expect(sync.getSnapshot().entries).toEqual([])
  expect(sync.getSnapshot().presence).toEqual([])
  expect(sync.getSnapshot().history).toMatchObject({
    viewingOlder: false,
    pending: false,
    error: null,
  })
})

test("a late snapshot cannot replace a newer loader snapshot or another Workspace", async () => {
  const { sync, adapter, sockets } = setup()
  const read = deferred<WorkspaceSnapshot>()
  const started = deferred<boolean>()
  adapter.workspace = () => {
    started.resolve(true)
    return read.promise
  }
  const refreshing = sync.refresh("workspace")
  await started.promise
  const next = snapshot("workspace-2", "session-2")
  sync.replace(next)
  read.resolve(snapshot())
  await refreshing
  expect(sync.getSnapshot().result.workspace.id).toBe("workspace-2")
  expect(sockets[0].closed).toBe(1)
  expect(sockets[1].options.workspaceId).toBe("workspace-2")
})

test("reconnect preserves applied streaming text and uses one socket", async () => {
  const { sync, sockets } = setup()
  await sockets[0].options.onEvent(delta("Hel"))
  sockets[0].options.onConnecting()
  await sockets[0].options.onEvent(delta("lo"))
  sockets[0].options.onSynced(12)
  await sync.refresh("workspace")
  expect(sync.getSnapshot().entries.map((entry) => entry.body)).toEqual([
    "Hello",
  ])
  expect(sockets).toHaveLength(1)
  sync.pause()
  sync.resume()
  expect(sockets[0].paused).toBe(1)
  expect(sockets[0].resumed).toBe(1)
})

test("answered permissions do not reappear from snapshots or replay", async () => {
  const initial = snapshot()
  initial.runtime = { ...initial.runtime, permissions: [permission] }
  const { sync, sockets } = setup(initial)
  expect(sync.getSnapshot().permissionRequests).toEqual([
    {
      id: permission.id,
      action: permission.action,
      resources: permission.resources,
      message: undefined,
      canSave: true,
    },
  ])
  await sockets[0].options.onEvent(
    new WorkspaceRuntimeEvent({
      id: "reply",
      created: 1,
      type: "permission.replied",
      data: { sessionID: "session-1", requestID: permission.id, reply: "once" },
    })
  )
  await sync.refresh("runtime")
  await sockets[0].options.onEvent(
    new WorkspaceRuntimeEvent({
      id: "ask",
      created: 1,
      type: "permission.asked",
      data: permission,
    })
  )
  expect(sync.getSnapshot().permissionRequests).toEqual([])
})

test("a successful local permission reply also suppresses the durable copy", async () => {
  const initial = snapshot()
  initial.runtime = { ...initial.runtime, permissions: [permission] }
  const { sync } = setup(initial)
  sync.dismissPermissionRequest(permission.id)
  await sync.refresh("workspace")
  expect(sync.getSnapshot().permissionRequests).toEqual([])
})

test("optimistic messages remain until acknowledged and reconcile by message ID", () => {
  const { sync } = setup()
  const finish = sync.trackPrompt("message-1", "Build it")
  finish(true)
  expect(sync.getSnapshot().entries.map((entry) => entry.body)).toEqual([
    "Build it",
  ])
  const next = snapshot()
  next.runtime = {
    ...next.runtime,
    messages: [message("message-1", "Build it")],
  }
  sync.replace(next)
  expect(sync.getSnapshot().entries.map((entry) => entry.id)).toEqual([
    "message-1:text:0",
  ])
  sync.replace(snapshot())
  expect(sync.getSnapshot().entries).toEqual([])
})

test("acknowledgement in the queued inbox removes the optimistic transcript entry", () => {
  const { sync } = setup()
  sync.trackPrompt("message-1", "Build it", "queue")(true)
  const next = snapshot()
  next.runtime = {
    ...next.runtime,
    queuedMessages: [
      { id: "message-1", text: "Build it", delivery: "queue", createdAt: 1 },
    ],
  }
  sync.replace(next)
  expect(sync.getSnapshot().entries).toEqual([])
  expect(sync.getSnapshot().result.runtime.queuedMessages).toHaveLength(1)
})

test("same-session refreshes keep the selected history page", async () => {
  const { sync, adapter } = setup()
  adapter.messages = async () => ({
    messages: [message("old", "Earlier")],
    cursor: null,
  })
  await sync.loadOlder()
  const next = snapshot()
  next.runtime = { ...next.runtime, messages: [message("new", "Latest")] }
  sync.replace(next)
  expect(sync.getSnapshot().entries[0]?.body).toBe("Earlier")
  sync.showLatest()
  expect(sync.getSnapshot().entries[0]?.body).toBe("Latest")
})

test("showing latest invalidates an in-flight history request", async () => {
  const { sync, adapter } = setup()
  const page =
    deferred<Awaited<ReturnType<WorkspaceSynchronizationAdapter["messages"]>>>()
  adapter.messages = () => page.promise
  const loading = sync.loadOlder()
  sync.showLatest()
  page.resolve({ messages: [message("old", "Earlier")], cursor: null })
  await loading
  expect(sync.getSnapshot().history.viewingOlder).toBeFalse()
  expect(sync.getSnapshot().entries).toEqual([])
})

test("provisioning messages survive the transition to an initialized session", () => {
  const initial = snapshot("workspace-1", null)
  initial.workspace.status = "provisioning"
  const { sync, sockets } = setup(initial)
  sync.trackPrompt("pending", "Build it")(true)
  expect(sockets).toHaveLength(0)
  sync.replace(snapshot())
  expect(sockets).toHaveLength(1)
  expect(sync.getSnapshot().entries[0]?.body).toBe("Build it")
})

test("stopping invalidates reads and closes the socket", async () => {
  const { sync, adapter, sockets } = setup()
  const read = deferred<WorkspaceSnapshot>()
  const started = deferred<boolean>()
  adapter.workspace = () => {
    started.resolve(true)
    return read.promise
  }
  const refreshing = sync.refresh("workspace")
  await started.promise
  sync.stop()
  let notified = 0
  const unsubscribe = sync.subscribe(() => {
    notified += 1
  })
  read.resolve(snapshot("late", "late"))
  await refreshing
  expect(notified).toBe(0)
  expect(sockets[0].closed).toBe(1)
  unsubscribe()
})

test("failed refreshes report an error and recover through the same interface", async () => {
  const { sync, adapter } = setup()
  adapter.runtime = async () => {
    throw new Error("offline")
  }
  await sync.refresh("runtime")
  expect(sync.getSnapshot().refreshError).toContain("Live updates paused")
  adapter.runtime = async () => snapshot().runtime
  await sync.refresh("runtime")
  expect(sync.getSnapshot().refreshError).toBeNull()
})

test("provisioning polls until the session is available, then stops when idle", async () => {
  const initial = snapshot("workspace-1", null)
  initial.workspace.status = "provisioning"
  const { sync, adapter, sockets } = setup(initial)
  let reads = 0
  adapter.workspace = async () => {
    reads += 1
    return snapshot()
  }
  await new Promise((resolve) => setTimeout(resolve, 2150))
  expect(reads).toBe(1)
  expect(sockets).toHaveLength(1)
  expect(sync.getSnapshot().result.runtime.sessionId).toBe("session-1")
  await new Promise((resolve) => setTimeout(resolve, 2150))
  expect(reads).toBe(1)
}, 10000)

test("permissions resolved during disconnection disappear on reconnect", async () => {
  const { sync, sockets } = setup()
  await sockets[0].options.onEvent(
    new WorkspaceRuntimeEvent({
      id: "asked",
      created: 1,
      type: "permission.asked",
      data: permission,
    })
  )
  expect(sync.getSnapshot().permissionRequests).toHaveLength(1)
  sync.pause()
  sync.resume()
  sockets[0].options.onConnecting()
  sockets[0].options.onSynced(10)
  await sync.refresh("workspace")
  expect(sync.getSnapshot().permissionRequests).toEqual([])
})
