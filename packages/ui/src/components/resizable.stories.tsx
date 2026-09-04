import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./resizable"

const meta = {
  title: "Primitives/Resizable",
  component: ResizablePanelGroup,
} satisfies Meta<typeof ResizablePanelGroup>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <ResizablePanelGroup
      className="h-72 w-[640px] rounded-lg border"
      orientation="horizontal"
    >
      <ResizablePanel defaultSize="40%">
        <div className="grid size-full place-items-center">Navigation</div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel>
        <div className="grid size-full place-items-center">Workspace</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
}
