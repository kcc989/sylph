import type { Info } from "@opencode-ai/plugin/promise/tool"
import {
  WorkspaceBrowserResult,
  WorkspaceBrowserToolInput,
  WorkspaceBrowserToolJsonSchema,
  WorkspaceBrowserToolOutput,
} from "@workspace/domain"
import { Schema } from "effect"

const decodeWorkspaceBrowserToolInput = Schema.decodeUnknownPromise(
  WorkspaceBrowserToolInput
)

export const workspaceBrowserTool = (
  browser: (input: WorkspaceBrowserToolInput) => Promise<WorkspaceBrowserResult>
): Info<typeof WorkspaceBrowserToolJsonSchema> => ({
  name: "workspace_browser",
  description:
    "Test required user journeys in the exact current Preview's persistent Browser Run. Observe returns the User's policy. Use journey_begin with requirementId, actions and ordered assertions at each required viewport, then journey_finish. Use unique requestId per action and sessionId from start; exact retries return saved results without replay. Failed or interrupted journeys block acceptance until full retry or a User exception. viewport selects desktop/mobile; switch_page selects an observed popup page; popup opens an allowed URL. Human control blocks agent actions. Only the Preview and User-configured HTTPS origins are allowed. No arbitrary JavaScript. Cookies persist across reconnects, and the browser pauses between calls.",
  input: WorkspaceBrowserToolJsonSchema,
  options: { codemode: false },
  async execute(input) {
    const decoded = await decodeWorkspaceBrowserToolInput(input)
    const result = await browser(decoded)
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            new WorkspaceBrowserToolOutput({
              url: result.url,
              checkId: result.checkId,
              evidence: result.evidence,
              accessibility: result.accessibility,
              session: result.session,
              journey: result.journey,
              policy: result.policy,
              pages: result.pages,
              outcome: result.outcome,
              detail: result.detail,
            })
          ),
        },
        { type: "text", text: result.markdown },
      ],
    }
  },
})
