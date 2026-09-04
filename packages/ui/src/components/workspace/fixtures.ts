import type { BrowserState, CheckItem, ThreadEntry } from "./types"

export const workspaceEntries: ThreadEntry[] = [
  {
    id: "request",
    kind: "user",
    body: "Keep the workspace focused on chat and open a browser only when preview work begins.",
    meta: "You · 10:24",
  },
  {
    id: "inspect",
    kind: "tool",
    title: "Plan",
    body: "Move chat, browser, changes, checks, and terminal into one peer tab model.",
    meta: "4 steps",
    details: [
      "Audit the workspace shell and preview route",
      "Keep Project → Workspace hierarchy persistent",
      "Verify the browser at mobile and desktop widths",
      "Run typecheck, accessibility, and build checks",
    ],
  },
  {
    id: "result",
    kind: "result",
    title: "Workspace tabs implemented",
    body: "Chat opens first. Browser and review tools stay one click away without shrinking the active work surface.",
    meta: "2m 18s",
    artifact: {
      label: "Preview updated",
      detail: "http://127.0.0.1:3000/workspaces/preview",
    },
  },
  {
    id: "agent",
    kind: "agent",
    body: "I’m testing the workspace at desktop and mobile widths now. The browser remains the active target while the checks run.",
    meta: "Agent · now",
    artifact: { label: "Browser checks", detail: "3/3 passing" },
  },
]

export const workspaceChecks: CheckItem[] = [
  { name: "Typecheck", detail: "packages/ui", status: "passed" },
  { name: "Responsive preview", detail: "390px · 1440px", status: "running" },
  { name: "Accessibility", detail: "Storybook", status: "passed" },
]

export const workspaceBrowser: BrowserState = {
  url: "http://127.0.0.1:3000/workspaces/preview",
  title: "Build, preview, and verify in one durable workspace.",
  status: "live",
}
