import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import type { ComponentProps } from "react"

import { defaultPatch } from "@workspace/ui/components/code-review"
import {
  BrowserPreview,
  ReviewNotesSurface,
  ReviewSurface,
  WorkspaceChat,
  WorkspacePanes,
  WorkspaceRoot,
  WorkspaceToolPane,
  WorkspaceTopbar,
  TerminalSurface,
} from "@workspace/ui/components/workspace-shell"
import {
  workspaceBrowser,
  workspaceChecks,
  workspaceEntries,
} from "./workspace/fixtures"

function DemoPreview() {
  return (
    <div className="flex h-full items-center justify-center bg-[#171614] p-4">
      <div className="flex h-full max-h-[460px] w-full max-w-[390px] flex-col overflow-hidden rounded-[22px] border-[6px] border-[#292624] bg-[#f6f2ec] px-7 py-6 text-center text-[#201d19] shadow-[0_22px_60px_rgba(0,0,0,.42)]">
        <div className="flex items-center justify-between text-[10px] text-[#6b655f]">
          <span className="font-semibold text-[#a74231]">FolkHero</span>
          <span>Step 1 of 4</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center">
          <h2 className="max-w-xs text-2xl font-semibold tracking-[-0.035em] text-balance">
            Welcome to FolkHero
          </h2>
          <p className="mt-2 max-w-xs text-xs leading-5 text-pretty text-[#69635c]">
            Discover, save, and share the songs that move you.
          </p>
          <div className="mt-6 flex gap-2">
            <span className="h-0.5 w-8 bg-[#ef735d]" />
            <span className="h-0.5 w-8 bg-black/10" />
            <span className="h-0.5 w-8 bg-black/10" />
          </div>
          <button
            className="mt-7 w-full max-w-[240px] rounded-[5px] bg-[#ee715d] px-3 py-2.5 text-[11px] font-semibold text-white"
            type="button"
          >
            Create an account
          </button>
        </div>
      </div>
    </div>
  )
}

type WorkspaceStoryProps = {
  workspaceId: string
  projectName: string
  repositoryName: string
  workspaceName: string
} & Partial<
  ComponentProps<typeof WorkspaceTopbar> &
    ComponentProps<typeof WorkspaceChat> &
    ComponentProps<typeof WorkspaceToolPane>
>

function WorkspaceStory(props: WorkspaceStoryProps) {
  const browser = props.browser ?? workspaceBrowser
  const checks = props.checks ?? workspaceChecks

  return (
    <WorkspaceRoot className="h-dvh" workspaceId={props.workspaceId}>
      <WorkspaceTopbar
        {...props}
        agentControllingBrowser={props.agentControllingBrowser ?? false}
        archivePending={false}
        browser={browser}
        checks={checks}
        discardPending={false}
        projectName={props.projectName}
        rebasePending={false}
        repositoryName={props.repositoryName}
        restartPending={false}
        workspaceName={props.workspaceName}
      />
      <WorkspacePanes
        terminal={
          <TerminalSurface
            entries={props.entries ?? workspaceEntries}
            checks={checks}
          />
        }
        chat={
          <WorkspaceChat
            {...props}
            cancelTurnPending={false}
            entries={props.entries ?? workspaceEntries}
            models={props.models ?? []}
            permissionRequests={props.permissionRequests ?? []}
            promptPending={false}
            questions={props.questions ?? []}
            queuedMessages={props.queuedMessages ?? []}
            restartPending={false}
            skills={props.skills ?? []}
            turnActive={props.turnActive ?? false}
            turnInterrupted={props.turnInterrupted ?? false}
          />
        }
      >
        <WorkspaceToolPane
          {...props}
          entries={props.entries ?? workspaceEntries}
          checkpointDisabled={!props.onCheckpoint}
          acceptDisabled={!props.onAccept}
          browser={browser}
          checks={checks}
        />
      </WorkspacePanes>
    </WorkspaceRoot>
  )
}

const meta = {
  title: "Workspace/Workspace shell",
  component: WorkspaceStory,
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  args: {
    workspaceId: "storybook-companion-layout",
    projectName: "Sylph",
    repositoryName: "sylph",
    workspaceName: "Browser preview shell",
    patch: defaultPatch,
    changeSummary: "+286 −41",
    changedFileCount: 4,
    previewContent: <DemoPreview />,
    agentControllingBrowser: true,
    browser: workspaceBrowser,
    checks: workspaceChecks,
    entries: workspaceEntries,
    models: [
      {
        providerId: "openrouter",
        modelId: "aion/aion-2.0",
        name: "Aion-2.0",
        providerName: "OpenRouter",
        scope: "organization",
      },
      {
        providerId: "openrouter",
        modelId: "aion/aion-3.0",
        name: "Aion-3.0",
        providerName: "OpenRouter",
        scope: "organization",
      },
      {
        providerId: "openai",
        modelId: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        providerName: "OpenAI",
        scope: "personal",
      },
      {
        providerId: "anthropic",
        modelId: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        providerName: "Anthropic",
        scope: "organization",
      },
    ],
    selectedModel: {
      providerId: "openrouter",
      modelId: "aion/aion-2.0",
    },
    onAccept: fn(async () => undefined),
    onCheckpoint: fn(async () => undefined),
    onRestartWorkspace: fn(async () => undefined),
  },
} satisfies Meta<typeof WorkspaceStory>

export default meta
type Story = StoryObj<typeof meta>

export const TabbedWorkspace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText("Message the agent")).toBeVisible()
    await expect(canvas.getByLabelText("Send message")).toBeVisible()
    await expect(
      canvas.getByRole("combobox", { name: "Model and thinking settings" })
    ).toBeVisible()
    const openInspector = canvas.queryByLabelText("Open inspector")
    if (openInspector) await userEvent.click(openInspector)
    await userEvent.click(
      within(
        canvas.getByRole("region", { name: "Workspace inspector" })
      ).getByRole("button", { name: /^Changes/ })
    )
    await expect(
      canvas.getByRole("button", { name: "Checkpoint" })
    ).toBeVisible()
    await userEvent.type(
      canvas.getByLabelText("Message the agent"),
      "Keep this draft"
    )
    await userEvent.click(canvas.getByLabelText("Expand inspector"))
    const inspector = canvas.getByRole("region", {
      name: "Workspace inspector",
    })
    await expect(inspector.getBoundingClientRect().width).toBeGreaterThan(1000)
    await userEvent.click(canvas.getByLabelText("Restore conversation"))
    await expect(canvas.getByLabelText("Message the agent")).toHaveValue(
      "Keep this draft"
    )
    await userEvent.click(canvas.getByLabelText("Hide inspector"))
    await userEvent.click(canvas.getByLabelText("Open inspector"))
    await expect(canvas.getByLabelText("More inspection tools")).toBeVisible()
    await expect(canvas.getByLabelText("More workspace actions")).toBeVisible()
  },
}

export const WaitingForAgent: Story = {
  args: {
    browser: {
      url: "http://127.0.0.1:3000",
      title: "The preview will reconnect when the development server is ready.",
      status: "loading",
    },
    checks: [
      { name: "Install dependencies", detail: "12s", status: "passed" },
      { name: "Start preview", detail: "waiting", status: "running" },
      { name: "Browser verification", detail: "queued", status: "queued" },
    ],
  },
}

export const TurnControls: Story = {
  args: {
    turnActive: true,
    activeTurnStartedAt: Date.now() - 4 * 60 * 1000,
    runtimeLimits: {
      maxQueuedMessages: 5,
      maxTurnDurationMs: 15 * 60 * 1000,
      maxCheckAttempts: 3,
      maxRepairAttempts: 2,
    },
    queuedMessages: [
      {
        id: "queued-1",
        text: "After this, add the empty state for a new Project.",
        createdAt: Date.now(),
        delivery: "queue",
      },
    ],
    questions: [
      {
        id: "question-1",
        title: "Choose the default visibility",
        status: "pending",
        answer: null,
        fields: [
          {
            key: "visibility",
            title: "Project visibility",
            description: "The agent will use this for the new repository.",
            required: true,
            type: "string",
            options: [
              { value: "private", label: "Private" },
              { value: "public", label: "Public" },
            ],
          },
        ],
      },
    ],
  },
}

export const InterruptedTurn: Story = {
  args: {
    turnInterrupted: true,
    runtimeLimits: {
      maxQueuedMessages: 5,
      maxTurnDurationMs: 15 * 60 * 1000,
      maxCheckAttempts: 3,
      maxRepairAttempts: 2,
    },
  },
}

export const BrowserError: Story = {
  args: {
    browser: {
      url: "http://127.0.0.1:3000",
      title: "The preview server stopped responding.",
      status: "error",
    },
    checks: [
      { name: "Typecheck", detail: "packages/ui", status: "passed" },
      { name: "Preview health", detail: "ECONNREFUSED", status: "failed" },
    ],
  },
}

export const Compact: Story = {
  parameters: {
    viewport: { defaultViewport: "mobile1" },
  },
}

export const BrowserSurface: Story = {
  render: () => (
    <div className="h-[640px]">
      <BrowserPreview
        browser={{
          url: "http://127.0.0.1:3000",
          title: "Build, preview, and verify in one durable workspace.",
          status: "live",
        }}
      />
    </div>
  ),
}

export const ReviewWithPierreDiffs: Story = {
  render: () => (
    <div className="h-[620px]">
      <ReviewSurface
        changedFileCount={4}
        changeSummary="+286 −41"
        patch={defaultPatch}
      />
    </div>
  ),
}

const reviewer = {
  id: "reviewer-casey",
  name: "Casey Collins",
  image: null,
}

export const ReviewWorkflow: Story = {
  render: () => (
    <div className="h-[720px]">
      <ReviewNotesSurface
        currentReviewer={reviewer}
        onAddComment={async () => true}
        onResolveComment={async () => undefined}
        onSubmitReview={async () => undefined}
        patch={defaultPatch}
        review={{
          commit: "bfd041e99a5ce7db0b13822b8e8b742ea3204bf2",
          decision: "changes_requested",
          reviewer,
          submittedAt: Date.now(),
          comments: [
            {
              id: "review-comment-1",
              file: "apps/web/src/routes/workspaces/$workspaceId.tsx",
              side: "additions",
              startLine: 18,
              endLine: 20,
              body: "Keep the route loading state visible until the Workspace snapshot has finished loading.",
              author: reviewer,
              createdAt: Date.now(),
              resolvedAt: null,
              resolvedBy: null,
            },
          ],
        }}
      />
    </div>
  ),
}

export const CompanionWorkflow: Story = {
  args: {
    workspaceId: "storybook-companion-workflow",
    onSubmitPrompt: fn(async () => true),
    onReadPatch: fn(async () => defaultPatch),
    onReadFile: fn(async (path: string) => ({
      path,
      size: 24,
      updatedAt: 0,
      encoding: "utf8" as const,
      content: "export const ready = true",
    })),
    files: ["src/index.ts"],
    currentReviewer: reviewer,
    review: {
      commit: "bfd041e99a5ce7db0b13822b8e8b742ea3204bf2",
      decision: "pending",
      reviewer: null,
      submittedAt: null,
      comments: [],
    },
    onSubmitReview: fn(async () => undefined),
    checks: [
      {
        name: "Typecheck",
        detail: "Passed",
        status: "passed",
        commit: "bfd041e99a5ce7db0b13822b8e8b742ea3204bf2",
        target: "checkpoint",
        output: "Typecheck passed",
      },
    ],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const inspector = within(
      canvas.getByRole("region", { name: "Workspace inspector" })
    )
    await userEvent.click(inspector.getByRole("button", { name: "Preview" }))
    await expect(args.onReadPatch).not.toHaveBeenCalled()
    await userEvent.click(
      canvas.getByRole("button", { name: "Reference preview" })
    )
    await userEvent.click(inspector.getByRole("button", { name: "Files" }))
    await userEvent.click(canvas.getByRole("button", { name: "index.ts" }))
    await waitFor(() => {
      const viewer = canvasElement.querySelector("diffs-container")
      expect(viewer?.shadowRoot?.textContent).toContain(
        "export const ready = true"
      )
    })
    const tree = canvas.getByRole("complementary", { name: "File tree" })
    const contents = canvas.getByLabelText("File contents")
    expect(contents.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      tree.getBoundingClientRect().right
    )
    await userEvent.click(inspector.getByRole("button", { name: "Preview" }))
    await userEvent.click(inspector.getByRole("button", { name: "Files" }))
    await expect(
      canvas.getByText("src/index.ts", { exact: true })
    ).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: "Hide file tree" })
    )
    await expect(tree).not.toBeVisible()
    await expect(contents).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: "Show file tree" })
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Reference file" })
    )
    await userEvent.type(
      canvas.getByLabelText("Message the agent"),
      "Check these"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Send message" }))
    await expect(args.onSubmitPrompt).toHaveBeenCalledWith(
      expect.stringContaining("Workspace file: src/index.ts"),
      args.selectedModel,
      undefined
    )
    await expect(
      canvas.queryByLabelText("Attached context")
    ).not.toBeInTheDocument()
    await userEvent.click(inspector.getByRole("button", { name: /^Changes/ }))
    await expect(args.onReadPatch).toHaveBeenCalledWith("working")
    await expect(
      canvas.queryByRole("button", { name: "Accept checkpoint" })
    ).not.toBeInTheDocument()
    await userEvent.selectOptions(canvas.getByLabelText("Compare"), "branch")
    await expect(args.onReadPatch).toHaveBeenCalledWith("branch")
    await userEvent.click(
      await canvas.findByRole("button", { name: "Review · 0 comments" })
    )
    await userEvent.click(canvas.getByRole("button", { name: "Approve" }))
    await expect(args.onSubmitReview).toHaveBeenCalledWith("approved")
    await expect(
      canvas.getByRole("button", { name: "Accept checkpoint" })
    ).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: "Command output" })
    )
    await expect(
      canvas.getByRole("region", { name: "Command output" })
    ).toBeVisible()
    const handle = canvas.getByRole("separator", {
      name: "Resize command output",
    })
    handle.focus()
    const before = canvas
      .getByRole("region", { name: "Command output" })
      .getBoundingClientRect().height
    await userEvent.keyboard("{ArrowUp}")
    await expect(
      canvas
        .getByRole("region", { name: "Command output" })
        .getBoundingClientRect().height
    ).toBeGreaterThan(before)
  },
}

export const FailedPromptKeepsContext: Story = {
  args: {
    workspaceId: "storybook-companion-failed-prompt",
    onSubmitPrompt: fn(async () => false),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole("button", { name: "Reference preview" })
    )
    await userEvent.type(
      canvas.getByLabelText("Message the agent"),
      "Try this change"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Send message" }))
    await expect(canvas.getByLabelText("Message the agent")).toHaveValue(
      "Try this change"
    )
    await expect(canvas.getByLabelText("Attached context")).toBeVisible()
  },
}
