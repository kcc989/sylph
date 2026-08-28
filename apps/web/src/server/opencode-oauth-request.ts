export interface OpenAIOAuthRequestState {
  active: boolean
  accountID: string | null
}

export interface OpenAIModelRequest {
  baseURL?: string
  headers: Record<string, string>
  sessionID: string
}

export const applyOpenAIOAuthRequest = (
  request: OpenAIModelRequest,
  state: OpenAIOAuthRequestState
) => {
  if (!state.active) return

  request.baseURL = "https://chatgpt.com/backend-api/codex"
  request.headers.originator = "opencode"
  request.headers["session-id"] = request.sessionID

  if (state.accountID) {
    request.headers["chatgpt-account-id"] = state.accountID
  }
}
