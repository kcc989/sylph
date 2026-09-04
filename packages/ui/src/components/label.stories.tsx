import type { Meta, StoryObj } from "@storybook/react-vite"
import { Label } from "./label"

const meta = {
  title: "Primitives/Label",
  component: Label,
  args: { children: "Workspace name" },
} satisfies Meta<typeof Label>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
