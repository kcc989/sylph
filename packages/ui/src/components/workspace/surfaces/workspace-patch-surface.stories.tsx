import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { WorkspacePatchSurface } from "./workspace-patch-surface"

const meta = {
  title: "Workspace/Patch loading",
  component: WorkspacePatchSurface,
  args: {
    scope: "working",
    children: (patch) => <pre>{patch || "No changes"}</pre>,
  },
} satisfies Meta<typeof WorkspacePatchSurface>

export default meta
type Story = StoryObj<typeof meta>

export const Loaded: Story = {
  args: { readPatch: fn(async () => "Updated application") },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.findByText("Updated application")
    ).resolves.toBeVisible()
    await expect(args.readPatch).toHaveBeenCalledWith("working")
  },
}

export const Loading: Story = {
  args: { readPatch: () => new Promise<string>(() => {}) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent(
      "Loading changes"
    )
  },
}

export const Retry: Story = {
  args: {
    readPatch: fn(async () => {
      throw new Error("offline")
    }),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.findByRole("alert")).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }))
    await expect(args.readPatch).toHaveBeenCalledTimes(2)
  },
}

function Draft() {
  const [body, setBody] = useState("")
  return (
    <textarea
      aria-label="Review comment"
      value={body}
      onChange={(event) => setBody(event.target.value)}
    />
  )
}

function RefreshingReview() {
  const [snapshot, setSnapshot] = useState(0)
  return (
    <div>
      <button onClick={() => setSnapshot((current) => current + 1)}>
        Refresh snapshot
      </button>
      <WorkspacePatchSurface
        scope="branch"
        revision="same-commit"
        readPatch={async () => {
          if (snapshot > 1) throw new Error("offline")
          return "patch"
        }}
      >
        {() => <Draft />}
      </WorkspacePatchSurface>
    </div>
  )
}

export const PreserveDraft: Story = {
  render: () => <RefreshingReview />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const comment = await canvas.findByRole("textbox", {
      name: "Review comment",
    })
    await userEvent.type(comment, "Keep this review draft")
    await userEvent.click(
      canvas.getByRole("button", { name: "Refresh snapshot" })
    )
    await expect(
      canvas.getByRole("textbox", { name: "Review comment" })
    ).toHaveValue("Keep this review draft")
    await userEvent.click(
      canvas.getByRole("button", { name: "Refresh snapshot" })
    )
    await expect(canvas.findByRole("alert")).resolves.toBeVisible()
    await expect(
      canvas.getByRole("textbox", { name: "Review comment" })
    ).toHaveValue("Keep this review draft")
  },
}
