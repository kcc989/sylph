import type { ComponentProps } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"

import { ProductRail, ProjectNavigation, ShellRoot } from "./index"
import { shellItems, shellProjects } from "./fixtures"

const ShellStory = ({
  projects = shellProjects,
}: {
  projects?: ComponentProps<typeof ProjectNavigation>["projects"]
}) => (
  <ShellRoot
    navigation={
      <ProjectNavigation organizationName="Folk Hero" projects={projects} />
    }
    productRail={
      <ProductRail brand={<a href="#home">Sylph</a>} items={shellItems} />
    }
    topbar="Projects"
  >
    <div className="p-8">Workspace content</div>
  </ShellRoot>
)

const meta = {
  title: "Shell/Application shell",
  component: ShellStory,
} satisfies Meta<typeof ShellStory>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText("Product navigation")).toBeVisible()
    await expect(
      canvas.getByLabelText("Project and Workspace navigation")
    ).toBeVisible()
    await userEvent.click(canvas.getByLabelText("Close navigation"))
    await expect(canvas.getByLabelText("Open navigation")).toBeVisible()
    await expect(
      canvas.getByLabelText("Project and Workspace navigation")
    ).not.toBeVisible()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await userEvent.click(canvas.getByLabelText("Open navigation"))
      await expect(
        canvas.getByLabelText("Project and Workspace navigation")
      ).toBeVisible()
      await userEvent.click(canvas.getByLabelText("Close navigation"))
      await expect(
        canvas.getByLabelText("Project and Workspace navigation")
      ).not.toBeVisible()
    }
  },
}

export const LongProjectNames: Story = {
  args: {
    projects: shellProjects.map((project) => ({
      ...project,
      name: "A long project name that must fit inside its navigation pane",
      workspaces: project.workspaces.map((workspace) => ({
        ...workspace,
        title: "A long workspace title that must leave room for its status",
      })),
    })),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const open = canvas.getByLabelText("Open navigation")
    if (open.getBoundingClientRect().width > 0) await userEvent.click(open)
    const navigation = canvas.getByLabelText("Project and Workspace navigation")
    const bounds = navigation.getBoundingClientRect()
    await expect(bounds.width).toBeGreaterThanOrEqual(180)
    for (const element of navigation.querySelectorAll("a, button")) {
      await expect(element.getBoundingClientRect().right).toBeLessThanOrEqual(
        bounds.right
      )
    }
    const scroller = navigation.querySelector("header + div")
    await expect(scroller?.scrollWidth).toBe(scroller?.clientWidth)
  },
}
