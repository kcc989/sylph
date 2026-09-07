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
    "Test the exact current Checkpoint Preview in one persistent Cloudflare Browser Run page. Start, observe, navigate with path/url, click, fill, select, press, scroll, wait, reload, assert, or close. Reuse the returned session.id as sessionId for actions. CSS selectors must identify one element for interactions. Assertions use exact text/value/count/checked/visible expectations. Each call returns its outcome, page text, accessibility, and saved Check Evidence. Cookies and local storage persist until close or 10 minutes idle. No arbitrary JavaScript, external navigation, or popups.",
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
