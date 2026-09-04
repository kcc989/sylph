import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"

import { ProductRail, ProjectNavigation, ShellRoot } from "./index"
import { shellItems, shellProjects } from "./fixtures"

const ShellStory = () => (
  <ShellRoot
    navigation={
      <ProjectNavigation
        organizationName="Folk Hero"
        projects={shellProjects}
      />
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
  },
}
