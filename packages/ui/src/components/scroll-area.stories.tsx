import type { Meta, StoryObj } from "@storybook/react-vite"
import { ScrollArea } from "./scroll-area"

const meta = {
  title: "Primitives/Scroll area",
  component: ScrollArea,
} satisfies Meta<typeof ScrollArea>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <ScrollArea className="h-48 w-72 rounded-lg border p-3">
      {Array.from({ length: 20 }, (_, index) => (
        <p className="py-1" key={index}>
          Workspace event {index + 1}
        </p>
      ))}
    </ScrollArea>
  ),
}
