import type { Meta, StoryObj } from "@storybook/react-vite"
import { DeploymentPanel } from "./deployment-panel"

const commit = "a".repeat(40)
const meta = {
  title: "Workspace/DeploymentPanel",
  component: DeploymentPanel,
  args: {
    acceptedCommits: [{ commit, acceptedAt: "2026-09-07T12:00:00Z" }],
    deployments: [
      {
        id: "release-1",
        commit,
        status: "failed",
        actorName: "Admin",
        productionUrl: "https://example.com",
        failureDetails:
          "Production journey failed. Inspect application writes before recovery.",
        startedAt: null,
        completedAt: null,
        createdAt: "2026-09-07T12:00:00Z",
        recovery: {
          commit,
          capturedAt: 1788782400000,
          expiresAt: 1791374400000,
          resourceCount: 3,
          available: true,
        },
      },
    ],
    canDeploy: true,
    onDeploy: async () => undefined,
  },
} satisfies Meta<typeof DeploymentPanel>
export default meta
type Story = StoryObj<typeof meta>
export const Recovery: Story = {}
export const ReadOnly: Story = { args: { canDeploy: false } }
export const Running: Story = {
  args: {
    deployments: meta.args.deployments.map((deployment) => ({
      ...deployment,
      status: "running",
    })),
  },
}
