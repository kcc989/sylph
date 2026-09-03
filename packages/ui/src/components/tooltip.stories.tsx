import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "./button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip"

const meta = { title: "Primitives/Tooltip", component: Tooltip } satisfies Meta<
  typeof Tooltip
>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <TooltipProvider>
      <Tooltip defaultOpen>
        <TooltipTrigger render={<Button variant="outline" />}>
          Hover me
        </TooltipTrigger>
        <TooltipContent>Workspace actions</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
}
