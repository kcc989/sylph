import type { CodeReviewSide } from "@workspace/ui/components/code-review"
import type {
  AcceptedCommitItem,
  DeploymentItem,
} from "@workspace/ui/components/deployment-panel"

export type ToolCallInputValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<ToolCallInputValue>
  | { readonly [key: string]: ToolCallInputValue }

export type ToolCallInput = { readonly [key: string]: ToolCallInputValue }

export type ToolCallDetail =
  | {
      kind: "diff"
      files: ReadonlyArray<{
        file: string
        status: "added" | "modified" | "deleted"
        additions: number
        deletions: number
        patch: string
      }>
    }
  | {
      kind: "browser"
      url: string
      evidence: ReadonlyArray<{
        id: string
        kind: "screenshot" | "accessibility"
        label: string
        url: string
      }>
      markdown: string
      accessibility: string
    }
  | {
      kind: "checks"
      runs: ReadonlyArray<{ id: string; status: string; label: string }>
    }

export type ToolCallEntry = {
  id: string
  name: string
  status: "running" | "completed" | "error"
  input: ToolCallInput
  output: string
  outputTruncated: boolean
  files: ReadonlyArray<{ uri: string; mime: string; name?: string }>
  error: string | null
  detail?: ToolCallDetail
}

export type ThreadEntry = {
  id: string
  kind: "user" | "agent" | "tool" | "result"
  title?: string
  body: string
  skill?: { name: string; scope: "installation" | "project"; prompt: string }
  meta?: string
  details?: string[]
  artifact?: { label: string; detail: string }
  tool?: ToolCallEntry
}

export type WorkspacePermissionRequest = {
  id: string
  action: string
  resources: string[]
  message?: string
  canSave: boolean
}

export type WorkspaceQuestionValue =
  | string
  | number
  | boolean
  | ReadonlyArray<string>

export type WorkspaceQuestion = {
  id: string
  title: string
  status: "pending" | "answered" | "cancelled"
  fields: ReadonlyArray<{
    key: string
    title?: string
    description?: string
    required?: boolean
    type:
      | "string"
      | "number"
      | "integer"
      | "boolean"
      | "multiselect"
      | "external"
    options: ReadonlyArray<{
      value: string
      label: string
      description?: string
    }>
    placeholder?: string
    url?: string
    defaultValue?: WorkspaceQuestionValue
  }>
  answer: Record<string, WorkspaceQuestionValue> | null
}

export type WorkspaceQueuedMessage = {
  id: string
  text: string
  createdAt: number
  delivery: "queue" | "steer"
}

export type WorkspaceRuntimeLimits = {
  maxQueuedMessages: number
  maxTurnDurationMs: number
  maxCheckAttempts: number
  maxRepairAttempts: number
  maxAutomaticRepairs?: number
}

export type WorkspacePresenceUser = {
  userId: string
  name: string
  connections: number
}

export type BrowserState = {
  commit?: string
  url: string
  title: string
  status: "live" | "loading" | "error"
}

export type CheckItem = {
  commit?: string
  target?: "checkpoint" | "production"
  name: string
  detail: string
  status: "queued" | "passed" | "running" | "failed"
  output?: string
  evidence?: ReadonlyArray<{
    id: string
    kind: "screenshot" | "accessibility"
    label: string
    url: string
  }>
  action?: { label: string; disabled?: boolean; onClick: () => void }
}

export type WorkspaceReviewActor = {
  id: string
  name: string
  image: string | null
}

export type WorkspaceReviewComment = {
  id: string
  file: string
  side: CodeReviewSide
  startLine: number
  endLine: number
  body: string
  author: WorkspaceReviewActor
  createdAt: number
  resolvedAt: number | null
  resolvedBy: WorkspaceReviewActor | null
}

export type WorkspaceReview = {
  commit: string
  decision: "pending" | "approved" | "changes_requested"
  reviewer: WorkspaceReviewActor | null
  submittedAt: number | null
  comments: ReadonlyArray<WorkspaceReviewComment>
}

export type WorkspaceReviewCommentDraft = {
  file: string
  side: CodeReviewSide
  startLine: number
  endLine: number
  body: string
}

export type ComposerModel = {
  providerId: string
  modelId: string
  name: string
  providerName: string
  scope: "personal" | "organization"
}

export type ComposerSkill = {
  name: string
  description: string
  scope: "installation" | "project"
}

export type WorkspaceCheckpoint = {
  id: string
  commit: string
  message: string
  createdAt: number
}

export type WorkspaceFileContentView = {
  path: string
  size: number
  updatedAt: number
  encoding: "utf8" | "binary" | "too-large" | "missing"
  content: string | null
}

export type WorkspaceFileChangeView = {
  file: string
  status: "added" | "modified" | "deleted"
}

export type WorkspaceDeployments = {
  acceptedCommits: ReadonlyArray<AcceptedCommitItem>
  deployments: ReadonlyArray<DeploymentItem>
}
