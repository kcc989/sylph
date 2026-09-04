import { WorkspaceId, WorkspaceRuntimeHealth } from "@workspace/domain"
import {
  maxWorkspaceAutomaticRepairs,
  maxWorkspaceCheckAttempts,
  maxWorkspaceRepairAttempts,
} from "./workspace-checks"

export const maxQueuedMessages = 5
export const maxTurnDurationMs = 15 * 60 * 1000

export const provisioningRuntimeHealth = (workspaceId: string) =>
  new WorkspaceRuntimeHealth({
    workspaceId: WorkspaceId.make(workspaceId),
    sessionId: null,
    eventCursor: null,
    status: "provisioning",
    model: null,
    files: [],
    messages: [],
    queuedMessages: [],
    questions: [],
    permissions: [],
    lastTurnOutcome: null,
    activeTurnStartedAt: null,
    limits: {
      maxQueuedMessages,
      maxTurnDurationMs,
      maxCheckAttempts: maxWorkspaceCheckAttempts,
      maxRepairAttempts: maxWorkspaceRepairAttempts,
      maxAutomaticRepairs: maxWorkspaceAutomaticRepairs,
    },
    automaticRepairsUsed: 0,
    archivedAt: null,
    opencode: { healthy: false },
  })
