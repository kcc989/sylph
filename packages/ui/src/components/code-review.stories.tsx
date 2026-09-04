import type { Meta, StoryObj } from "@storybook/react-vite"
import { CodeReview, defaultPatch } from "./code-review"

const meta = {
  title: "Primitives/Code review",
  component: CodeReview,
  args: { patch: defaultPatch },
} satisfies Meta<typeof CodeReview>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
