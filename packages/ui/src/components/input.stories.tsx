import type { Meta, StoryObj } from "@storybook/react-vite"
import { Input } from "./input"

const meta = {
  title: "Primitives/Input",
  component: Input,
  args: { "aria-label": "Workspace name", placeholder: "amber-otter" },
} satisfies Meta<typeof Input>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
