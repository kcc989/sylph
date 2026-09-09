import {
  WorkspaceRunChecksInput,
  WorkspaceCreatePreviewInput,
  WorkspacePreviewResult,
} from "@workspace/domain"
import {
  WorkspaceBrowserAcceptanceInput,
  WorkspaceHumanBrowserInput,
  WorkspaceBrowserPolicyInput,
  WorkspaceBrowserExceptionInput,
  WorkspaceBrowserResult,
} from "@workspace/domain"
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
  WorkspaceRetryCheckInput,
  WorkspaceRuntimeHealth,
  WorkspaceMessagePageInput,
  WorkspaceMessagePage,
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
import type { WorkspaceDO } from "./workspace-do"

type WorkspaceRuntimeMethods = Pick<
  WorkspaceDO,
  | "connectKey"
  | "startSubscriptionSignIn"
  | "subscriptionSignInStatus"
  | "cancelSubscriptionSignIn"
  | "initialize"
  | "runChecks"
  | "createPreview"
  | "checkpoint"
  | "listChecks"
  | "readFile"
  | "applyCheckUpdate"
  | "archive"
  | "retryCheck"
  | "updateProject"
  | "rebase"
  | "versionControl"
  | "prompt"
  | "cancelTurn"
  | "reloadSkills"
  | "replyPermission"
  | "disconnectUser"
  | "answerQuestion"
  | "discard"
  | "evict"
  | "listMessages"
  | "snapshot"
  | "browserAction"
  | "reserveBrowserAcceptance"
  | "configureBrowser"
  | "exceptBrowser"
>

export type WorkspaceRuntimeStub = {
  [Method in keyof WorkspaceRuntimeMethods]: (
    ...args: Parameters<WorkspaceRuntimeMethods[Method]>
  ) => Promise<Awaited<ReturnType<WorkspaceRuntimeMethods[Method]>>>
} & {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>
}

export type WorkspaceSocketActor = {
  userId: string
  name: string
  writable: boolean
}

export type WorkspaceRuntime = ReturnType<typeof makeWorkspaceRuntime>

const socketUrl = "https://workspace/socket"

const call = async <Value>(operation: () => Promise<Value>) => {
  try {
    return await operation()
  } catch (cause) {
    throw runtimeFailure(cause)
  }
}

const decodeKeySetupInput = Schema.decodeUnknownSync(OpenCodeKeySetupInput)
const encodeKeySetupInputSync = Schema.encodeSync(OpenCodeKeySetupInput)
const encodeKeySetupInput = (input: typeof OpenCodeKeySetupInput.Encoded) =>
  encodeKeySetupInputSync(decodeKeySetupInput(input))
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
const encodeMessagePageInput = Schema.encodeSync(WorkspaceMessagePageInput)
const decodeMessagePage = Schema.decodeUnknownSync(WorkspaceMessagePage)
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

export const makeWorkspaceRuntime = (stub: WorkspaceRuntimeStub) => ({
  runChecks: (input: WorkspaceRunChecksInput) =>
    call(async () =>
      decodeCheckRun(
        await stub.runChecks(Schema.encodeSync(WorkspaceRunChecksInput)(input))
      )
    ),
  createPreview: (input: WorkspaceCreatePreviewInput) =>
    call(async () =>
      Schema.decodeUnknownSync(WorkspacePreviewResult)(
        await stub.createPreview(
          Schema.encodeSync(WorkspaceCreatePreviewInput)(input)
        )
      )
    ),
  reserveBrowserAcceptance: (
    input: typeof WorkspaceBrowserAcceptanceInput.Type
  ) =>
    call(() =>
      stub.reserveBrowserAcceptance(
        Schema.encodeSync(WorkspaceBrowserAcceptanceInput)(input)
      )
    ),
  browserAction: (
    input: typeof WorkspaceHumanBrowserInput.Type,
    userId: string
  ) =>
    call(async () =>
      Schema.decodeUnknownSync(WorkspaceBrowserResult)(
        await stub.browserAction(
          Schema.encodeSync(WorkspaceHumanBrowserInput)(input),
          userId
        )
      )
    ),
  configureBrowser: (
    input: typeof WorkspaceBrowserPolicyInput.Type,
    userId: string
  ) =>
    call(() =>
      stub.configureBrowser(
        Schema.encodeSync(WorkspaceBrowserPolicyInput)(input),
        userId
      )
    ),
  exceptBrowser: (
    input: typeof WorkspaceBrowserExceptionInput.Type,
    userId: string
  ) =>
    call(() =>
      stub.exceptBrowser(
        Schema.encodeSync(WorkspaceBrowserExceptionInput)(input),
        userId
      )
    ),
  connectKey: (input: typeof OpenCodeKeySetupInput.Encoded) =>
    call(async () =>
      decodeConnectionResult(await stub.connectKey(encodeKeySetupInput(input)))
    ),
  startSubscriptionSignIn: (input: OpenCodeSubscriptionStartInput) =>
    call(async () =>
      decodeSubscriptionAttempt(
        await stub.startSubscriptionSignIn(encodeSubscriptionStartInput(input))
      )
    ),
  subscriptionSignInStatus: (input: OpenCodeSubscriptionStatusInput) =>
    call(async () =>
      decodeSubscriptionRuntimeStatus(
        await stub.subscriptionSignInStatus(
          encodeSubscriptionStatusInput(input)
        )
      )
    ),
  cancelSubscriptionSignIn: (input: OpenCodeSubscriptionStatusInput) =>
    call(() =>
      stub.cancelSubscriptionSignIn(encodeSubscriptionStatusInput(input))
    ),
  initialize: (input: InitializeWorkspaceRuntime) =>
    call(async () =>
      decodeRuntimeHealth(await stub.initialize(encodeInitializeInput(input)))
    ),
  checkpoint: (input: WorkspaceCheckpointInput) =>
    call(async () =>
      decodeCheckpointResult(
        await stub.checkpoint(encodeCheckpointInput(input))
      )
    ),
  listChecks: () =>
    call(async () => decodeCheckRunList(await stub.listChecks())),
  readFile: (input: WorkspaceReadFileInput) =>
    call(async () =>
      decodeFileContent(await stub.readFile(encodeReadFileInput(input)))
    ),
  applyCheckUpdate: (update: WorkspaceCheckUpdate) =>
    call(async () =>
      decodeCheckUpdateResult(
        await stub.applyCheckUpdate(encodeCheckUpdate(update))
      )
    ),
  archive: (input: WorkspaceArchiveInput) =>
    call(async () =>
      decodeArchiveResult(await stub.archive(encodeArchiveInput(input)))
    ),
  retryCheck: (input: WorkspaceRetryCheckInput) =>
    call(async () =>
      decodeCheckRun(await stub.retryCheck(encodeRetryCheckInput(input)))
    ),
  updateProject: () =>
    call(async () => decodeSyncResult(await stub.updateProject())),
  rebase: () => call(async () => decodeRebaseResult(await stub.rebase())),
  versionControl: (refreshProjectHead: boolean, includePatches?: boolean) =>
    call(async () => {
      const snapshot = await stub.versionControl(
        refreshProjectHead,
        includePatches
      )
      return snapshot ? decodeVersionControlSnapshot(snapshot) : null
    }),
  prompt: (input: WorkspaceRuntimePromptInput) =>
    call(async () =>
      decodeRuntimeHealth(await stub.prompt(encodePromptInput(input)))
    ),
  cancelTurn: (input: WorkspaceTurnCancelInput) =>
    call(async () =>
      decodeTurnCancelResult(
        await stub.cancelTurn(encodeTurnCancelInput(input))
      )
    ),
  reloadSkills: () =>
    call(async () => decodeSkillReloadResult(await stub.reloadSkills())),
  replyPermission: (input: WorkspacePermissionReplyInput) =>
    call(() => stub.replyPermission(encodePermissionReplyInput(input))),
  disconnectUser: (input: WorkspaceDisconnectUserInput) =>
    call(() => stub.disconnectUser(encodeDisconnectUserInput(input))),
  answerQuestion: (input: WorkspaceQuestionReplyInput) =>
    call(() => stub.answerQuestion(encodeQuestionReplyInput(input))),
  discard: () => call(() => stub.discard()),
  evict: () => call(() => stub.evict()),
  listMessages: (input: WorkspaceMessagePageInput) =>
    call(async () =>
      decodeMessagePage(await stub.listMessages(encodeMessagePageInput(input)))
    ),
  snapshot: () => call(async () => decodeRuntimeHealth(await stub.snapshot())),
  socket: (request: Request, actor: WorkspaceSocketActor) => {
    const headers = new Headers(request.headers)
    headers.set("x-sylph-user-id", actor.userId)
    headers.set("x-sylph-user-name", actor.name)
    headers.set("x-sylph-workspace-writable", actor.writable ? "1" : "0")
    return call(() =>
      stub.fetch(new Request(socketUrl, { method: "GET", headers }))
    )
  },
})
