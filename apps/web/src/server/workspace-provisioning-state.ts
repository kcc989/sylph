import {
  WorkspaceId,
  WorkspaceRuntimeHealth,
  type WorkspaceQueuedMessage,
} from "@workspace/domain"
import {
  maxWorkspaceCheckContinuations,
  maxWorkspaceCheckAttempts,
} from "./workspace-checks"

export const maxQueuedMessages = 5
export const maxTurnDurationMs = 15 * 60 * 1000

export const provisioningRuntimeHealth = (
  workspaceId: string,
  queuedMessages: ReadonlyArray<WorkspaceQueuedMessage> = []
) =>
  new WorkspaceRuntimeHealth({
    workspaceId: WorkspaceId.make(workspaceId),
    sessionId: null,
    eventCursor: null,
    status: "provisioning",
    model: null,
    files: [],
    messages: [],
    queuedMessages,
    questions: [],
    permissions: [],
    lastTurnOutcome: null,
    activeTurnStartedAt: null,
    limits: {
      maxQueuedMessages,
      maxTurnDurationMs,
      maxCheckAttempts: maxWorkspaceCheckAttempts,
      maxCheckContinuations: maxWorkspaceCheckContinuations,
    },
    checkContinuationsUsed: 0,
    archivedAt: null,
    opencode: { healthy: false },
  })
