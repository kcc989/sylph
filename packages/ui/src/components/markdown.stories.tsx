import type { Meta, StoryObj } from "@storybook/react-vite"
import { Markdown } from "./markdown"

const meta = {
  title: "Primitives/Markdown",
  component: Markdown,
  args: { children: "## Check complete\n\nAll tests passed." },
} satisfies Meta<typeof Markdown>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
