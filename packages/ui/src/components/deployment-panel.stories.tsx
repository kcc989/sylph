import { expect, fn, userEvent, within } from "storybook/test"
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

export const OptionalReleaseCapabilities: Story = {
  args: { deployments: [], onDeploy: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole("button", { name: "Deploy" }))
    const recovery = canvas.getByRole("checkbox", {
      name: "Use managed recovery and release verification",
    })
    const evidence = canvas.getByRole("checkbox", {
      name: "Capture browser evidence",
    })
    await expect(recovery).not.toBeChecked()
    await expect(evidence).not.toBeChecked()
    await userEvent.click(
      canvas.getByRole("button", { name: "Confirm deploy" })
    )
    await expect(args.onDeploy).toHaveBeenCalledWith(commit, undefined, {
      managedRelease: false,
      captureEvidence: false,
    })
    await userEvent.click(canvas.getByRole("button", { name: "Deploy" }))
    await userEvent.click(
      canvas.getByRole("checkbox", {
        name: "Use managed recovery and release verification",
      })
    )
    await userEvent.click(
      canvas.getByRole("checkbox", { name: "Capture browser evidence" })
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Confirm deploy" })
    )
    await expect(args.onDeploy).toHaveBeenCalledWith(commit, undefined, {
      managedRelease: true,
      captureEvidence: true,
    })
  },
}
