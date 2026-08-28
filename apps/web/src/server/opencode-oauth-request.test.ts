import { describe, expect, test } from "bun:test"

import {
  applyOpenAIOAuthRequest,
  type OpenAIModelRequest,
} from "./opencode-oauth-request"

describe("OpenCode OAuth requests", () => {
  test("routes subscription credentials through the ChatGPT Codex backend", () => {
    const request: OpenAIModelRequest = {
      baseURL: "https://api.openai.com/v1",
      headers: {},
      sessionID: "session_smoke",
    }

    applyOpenAIOAuthRequest(request, {
      active: true,
      accountID: "account_smoke",
    })

    expect(request).toEqual({
      baseURL: "https://chatgpt.com/backend-api/codex",
      headers: {
        "chatgpt-account-id": "account_smoke",
        originator: "opencode",
        "session-id": "session_smoke",
      },
      sessionID: "session_smoke",
    })
  })
})
