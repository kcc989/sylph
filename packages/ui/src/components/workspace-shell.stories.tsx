import type { Meta, StoryObj } from "@storybook/react-vite"

import { defaultPatch } from "@workspace/ui/components/code-review"
import {
  BrowserPreview,
  ProjectRail,
  ReviewNotesSurface,
  ReviewSurface,
  WorkspaceShell,
  fallbackProjects,
} from "@workspace/ui/components/workspace-shell"

function DemoPreview() {
  return (
    <div className="flex h-full items-center justify-center bg-[#171614] p-4">
      <div className="flex h-full max-h-[460px] w-full max-w-[390px] flex-col overflow-hidden rounded-[22px] border-[6px] border-[#292624] bg-[#f6f2ec] px-7 py-6 text-center text-[#201d19] shadow-[0_22px_60px_rgba(0,0,0,.42)]">
        <div className="flex items-center justify-between text-[10px] text-[#6b655f]">
          <span className="font-semibold text-[#a74231]">FolkHero</span>
          <span>Step 1 of 4</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="mb-6 grid size-10 place-items-center rounded-full border border-[#e66f57] text-[#e66f57]">
            ♪
          </div>
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

const meta = {
  title: "Workspace/Workspace shell",
  component: WorkspaceShell,
  parameters: {
    viewport: { defaultViewport: "responsive" },
  },
  args: {
    organization: "Folk Hero",
    projectName: "Sylph",
    repositoryName: "sylph",
    workspaceName: "Browser preview shell",
    patch: defaultPatch,
    changeSummary: "+286 −41",
    changedFileCount: 4,
    previewContent: <DemoPreview />,
    agentControllingBrowser: true,
    demo: true,
  },
} satisfies Meta<typeof WorkspaceShell>

export default meta
type Story = StoryObj<typeof meta>

export const TabbedWorkspace: Story = {}

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

export const ProjectNavigator: Story = {
  render: () => (
    <div className="h-[760px] w-[268px]">
      <ProjectRail
        organization="Folk Hero"
        projects={fallbackProjects}
        workspaceName="Browser preview shell"
      />
    </div>
  ),
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
