import {
  InitializeWorkspaceRuntime,
  OpenCodeConnectionResult,
  OpenCodeKeySetupInput,
  OpenCodeSubscriptionAttempt,
  OpenCodeSubscriptionRuntimeStatus,
  OpenCodeSubscriptionStartInput,
  OpenCodeSubscriptionStatusInput,
  runtimeFailure,
  WorkspaceArchiveInput,
  WorkspaceArchiveResult,
  WorkspaceCheckpointInput,
  WorkspaceCheckpointResult,
  WorkspaceCheckRun,
  WorkspaceCheckRunList,
  WorkspaceCheckUpdate,
  WorkspaceCheckUpdateResult,
  WorkspacePermissionReplyInput,
  WorkspaceQuestionReplyInput,
  WorkspaceRebaseResult,
  WorkspaceRepairCheckInput,
  WorkspaceRepairResult,
  WorkspaceRetryCheckInput,
  WorkspaceRuntimeHealth,
  WorkspaceRuntimePromptInput,
  WorkspaceSkillReloadResult,
  WorkspaceSyncResult,
  WorkspaceTurnCancelInput,
  WorkspaceTurnCancelResult,
  WorkspaceVersionControlSnapshot,
  WorkspaceDisconnectUserInput,
  WorkspaceReadFileInput,
  WorkspaceFileContent,
} from "@workspace/domain"
import { Schema } from "effect"

export interface WorkspaceRuntimeStub {
  connectKey(
    input: typeof OpenCodeKeySetupInput.Encoded
  ): Promise<typeof OpenCodeConnectionResult.Encoded>
  startSubscriptionSignIn(
    input: typeof OpenCodeSubscriptionStartInput.Encoded
  ): Promise<typeof OpenCodeSubscriptionAttempt.Encoded>
  subscriptionSignInStatus(
    input: typeof OpenCodeSubscriptionStatusInput.Encoded
  ): Promise<typeof OpenCodeSubscriptionRuntimeStatus.Encoded>
  cancelSubscriptionSignIn(
    input: typeof OpenCodeSubscriptionStatusInput.Encoded
  ): Promise<void>
  initialize(
    input: typeof InitializeWorkspaceRuntime.Encoded
  ): Promise<typeof WorkspaceRuntimeHealth.Encoded>
  checkpoint(
    input: typeof WorkspaceCheckpointInput.Encoded
  ): Promise<typeof WorkspaceCheckpointResult.Encoded>
  listChecks(): Promise<typeof WorkspaceCheckRunList.Encoded>
  readFile(
    input: typeof WorkspaceReadFileInput.Encoded
  ): Promise<typeof WorkspaceFileContent.Encoded>
  applyCheckUpdate(
    update: typeof WorkspaceCheckUpdate.Encoded
  ): Promise<typeof WorkspaceCheckUpdateResult.Encoded>
  archive(
    input: typeof WorkspaceArchiveInput.Encoded
  ): Promise<typeof WorkspaceArchiveResult.Encoded>
  retryCheck(
    input: typeof WorkspaceRetryCheckInput.Encoded
  ): Promise<typeof WorkspaceCheckRun.Encoded>
  repairCheck(
    input: typeof WorkspaceRepairCheckInput.Encoded
  ): Promise<typeof WorkspaceRepairResult.Encoded>
  updateProject(): Promise<typeof WorkspaceSyncResult.Encoded>
  rebase(): Promise<typeof WorkspaceRebaseResult.Encoded>
  versionControl(
    refreshProjectHead: boolean
  ): Promise<typeof WorkspaceVersionControlSnapshot.Encoded | null>
  prompt(
    input: typeof WorkspaceRuntimePromptInput.Encoded
  ): Promise<typeof WorkspaceRuntimeHealth.Encoded>
  cancelTurn(
    input: typeof WorkspaceTurnCancelInput.Encoded
  ): Promise<typeof WorkspaceTurnCancelResult.Encoded>
  reloadSkills(): Promise<typeof WorkspaceSkillReloadResult.Encoded>
  replyPermission(
    input: typeof WorkspacePermissionReplyInput.Encoded
  ): Promise<void>
  disconnectUser(
    input: typeof WorkspaceDisconnectUserInput.Encoded
  ): Promise<void>
  answerQuestion(
    input: typeof WorkspaceQuestionReplyInput.Encoded
  ): Promise<void>
  discard(): Promise<void>
  evict(): Promise<void>
  snapshot(): Promise<typeof WorkspaceRuntimeHealth.Encoded>
  fetch(input: Request | string, init?: RequestInit): Promise<Response>
}

export type WorkspaceSocketActor = {
  userId: string
  name: string
  writable: boolean
}

export interface WorkspaceRuntime {
  connectKey(input: OpenCodeKeySetupInput): Promise<OpenCodeConnectionResult>
  startSubscriptionSignIn(
    input: OpenCodeSubscriptionStartInput
  ): Promise<OpenCodeSubscriptionAttempt>
  subscriptionSignInStatus(
    input: OpenCodeSubscriptionStatusInput
  ): Promise<OpenCodeSubscriptionRuntimeStatus>
  cancelSubscriptionSignIn(
    input: OpenCodeSubscriptionStatusInput
  ): Promise<void>
  initialize(input: InitializeWorkspaceRuntime): Promise<WorkspaceRuntimeHealth>
  checkpoint(
    input: WorkspaceCheckpointInput
  ): Promise<WorkspaceCheckpointResult>
  listChecks(): Promise<ReadonlyArray<WorkspaceCheckRun>>
  readFile(input: WorkspaceReadFileInput): Promise<WorkspaceFileContent>
  applyCheckUpdate(
    update: WorkspaceCheckUpdate
  ): Promise<WorkspaceCheckUpdateResult>
  archive(input: WorkspaceArchiveInput): Promise<WorkspaceArchiveResult>
  retryCheck(input: WorkspaceRetryCheckInput): Promise<WorkspaceCheckRun>
  repairCheck(input: WorkspaceRepairCheckInput): Promise<WorkspaceRepairResult>
  updateProject(): Promise<WorkspaceSyncResult>
  rebase(): Promise<WorkspaceRebaseResult>
  versionControl(
    refreshProjectHead: boolean
  ): Promise<WorkspaceVersionControlSnapshot | null>
  prompt(input: WorkspaceRuntimePromptInput): Promise<WorkspaceRuntimeHealth>
  cancelTurn(
    input: WorkspaceTurnCancelInput
  ): Promise<WorkspaceTurnCancelResult>
  reloadSkills(): Promise<WorkspaceSkillReloadResult>
  replyPermission(input: WorkspacePermissionReplyInput): Promise<void>
  disconnectUser(input: WorkspaceDisconnectUserInput): Promise<void>
  answerQuestion(input: WorkspaceQuestionReplyInput): Promise<void>
  discard(): Promise<void>
  evict(): Promise<void>
  snapshot(): Promise<WorkspaceRuntimeHealth>
  socket(request: Request, actor: WorkspaceSocketActor): Promise<Response>
}

const socketUrl = "https://workspace/socket"

const call = async <Value>(operation: () => Promise<Value>) => {
  try {
    return await operation()
  } catch (cause) {
    throw runtimeFailure(cause)
  }
}

const encodeKeySetupInput = Schema.encodeSync(OpenCodeKeySetupInput)
const decodeConnectionResult = Schema.decodeUnknownSync(
  OpenCodeConnectionResult
)
const encodeSubscriptionStartInput = Schema.encodeSync(
  OpenCodeSubscriptionStartInput
)
const decodeSubscriptionAttempt = Schema.decodeUnknownSync(
  OpenCodeSubscriptionAttempt
)
const encodeSubscriptionStatusInput = Schema.encodeSync(
  OpenCodeSubscriptionStatusInput
)
const decodeSubscriptionRuntimeStatus = Schema.decodeUnknownSync(
  OpenCodeSubscriptionRuntimeStatus
)
const encodeInitializeInput = Schema.encodeSync(InitializeWorkspaceRuntime)
const decodeRuntimeHealth = Schema.decodeUnknownSync(WorkspaceRuntimeHealth)
const encodeCheckpointInput = Schema.encodeSync(WorkspaceCheckpointInput)
const decodeCheckpointResult = Schema.decodeUnknownSync(
  WorkspaceCheckpointResult
)
const decodeCheckRunList = Schema.decodeUnknownSync(WorkspaceCheckRunList)
const encodeReadFileInput = Schema.encodeSync(WorkspaceReadFileInput)
const decodeFileContent = Schema.decodeUnknownSync(WorkspaceFileContent)
const decodeCheckRun = Schema.decodeUnknownSync(WorkspaceCheckRun)
const encodeCheckUpdate = Schema.encodeSync(WorkspaceCheckUpdate)
const decodeCheckUpdateResult = Schema.decodeUnknownSync(
  WorkspaceCheckUpdateResult
)
const encodeArchiveInput = Schema.encodeSync(WorkspaceArchiveInput)
const decodeArchiveResult = Schema.decodeUnknownSync(WorkspaceArchiveResult)
const encodeRetryCheckInput = Schema.encodeSync(WorkspaceRetryCheckInput)
const encodeRepairCheckInput = Schema.encodeSync(WorkspaceRepairCheckInput)
const decodeRepairResult = Schema.decodeUnknownSync(WorkspaceRepairResult)
const decodeSyncResult = Schema.decodeUnknownSync(WorkspaceSyncResult)
const decodeRebaseResult = Schema.decodeUnknownSync(WorkspaceRebaseResult)
const decodeVersionControlSnapshot = Schema.decodeUnknownSync(
  WorkspaceVersionControlSnapshot
)
const encodePromptInput = Schema.encodeSync(WorkspaceRuntimePromptInput)
const encodeTurnCancelInput = Schema.encodeSync(WorkspaceTurnCancelInput)
const decodeTurnCancelResult = Schema.decodeUnknownSync(
  WorkspaceTurnCancelResult
)
const decodeSkillReloadResult = Schema.decodeUnknownSync(
  WorkspaceSkillReloadResult
)
const encodePermissionReplyInput = Schema.encodeSync(
  WorkspacePermissionReplyInput
)
const encodeQuestionReplyInput = Schema.encodeSync(WorkspaceQuestionReplyInput)
const encodeDisconnectUserInput = Schema.encodeSync(
  WorkspaceDisconnectUserInput
)

export const makeWorkspaceRuntime = (
  stub: WorkspaceRuntimeStub
): WorkspaceRuntime => ({
  connectKey: (input) =>
    call(async () =>
      decodeConnectionResult(await stub.connectKey(encodeKeySetupInput(input)))
    ),
  startSubscriptionSignIn: (input) =>
    call(async () =>
      decodeSubscriptionAttempt(
        await stub.startSubscriptionSignIn(encodeSubscriptionStartInput(input))
      )
    ),
  subscriptionSignInStatus: (input) =>
    call(async () =>
      decodeSubscriptionRuntimeStatus(
        await stub.subscriptionSignInStatus(
          encodeSubscriptionStatusInput(input)
        )
      )
    ),
  cancelSubscriptionSignIn: (input) =>
    call(() =>
      stub.cancelSubscriptionSignIn(encodeSubscriptionStatusInput(input))
    ),
  initialize: (input) =>
    call(async () =>
      decodeRuntimeHealth(await stub.initialize(encodeInitializeInput(input)))
    ),
  checkpoint: (input) =>
    call(async () =>
      decodeCheckpointResult(
        await stub.checkpoint(encodeCheckpointInput(input))
      )
    ),
  listChecks: () =>
    call(async () => decodeCheckRunList(await stub.listChecks())),
  readFile: (input) =>
    call(async () =>
      decodeFileContent(await stub.readFile(encodeReadFileInput(input)))
    ),
  applyCheckUpdate: (update) =>
    call(async () =>
      decodeCheckUpdateResult(
        await stub.applyCheckUpdate(encodeCheckUpdate(update))
      )
    ),
  archive: (input) =>
    call(async () =>
      decodeArchiveResult(await stub.archive(encodeArchiveInput(input)))
    ),
  retryCheck: (input) =>
    call(async () =>
      decodeCheckRun(await stub.retryCheck(encodeRetryCheckInput(input)))
    ),
  repairCheck: (input) =>
    call(async () =>
      decodeRepairResult(await stub.repairCheck(encodeRepairCheckInput(input)))
    ),
  updateProject: () =>
    call(async () => decodeSyncResult(await stub.updateProject())),
  rebase: () => call(async () => decodeRebaseResult(await stub.rebase())),
  versionControl: (refreshProjectHead) =>
    call(async () => {
      const snapshot = await stub.versionControl(refreshProjectHead)
      return snapshot ? decodeVersionControlSnapshot(snapshot) : null
    }),
  prompt: (input) =>
    call(async () =>
      decodeRuntimeHealth(await stub.prompt(encodePromptInput(input)))
    ),
  cancelTurn: (input) =>
    call(async () =>
      decodeTurnCancelResult(
        await stub.cancelTurn(encodeTurnCancelInput(input))
      )
    ),
  reloadSkills: () =>
    call(async () => decodeSkillReloadResult(await stub.reloadSkills())),
  replyPermission: (input) =>
    call(() => stub.replyPermission(encodePermissionReplyInput(input))),
  disconnectUser: (input) =>
    call(() => stub.disconnectUser(encodeDisconnectUserInput(input))),
  answerQuestion: (input) =>
    call(() => stub.answerQuestion(encodeQuestionReplyInput(input))),
  discard: () => call(() => stub.discard()),
  evict: () => call(() => stub.evict()),
  snapshot: () => call(async () => decodeRuntimeHealth(await stub.snapshot())),
  socket: (request, actor) => {
    const headers = new Headers(request.headers)
    headers.set("x-sylph-user-id", actor.userId)
    headers.set("x-sylph-user-name", actor.name)
    headers.set("x-sylph-workspace-writable", actor.writable ? "1" : "0")
    return call(() =>
      stub.fetch(new Request(socketUrl, { method: "GET", headers }))
    )
  },
})
