import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"

const meta = { title: "Primitives/Select", component: Select } satisfies Meta<
  typeof Select
>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <Select defaultValue="ready">
      <SelectTrigger aria-label="Workspace status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ready">Ready</SelectItem>
        <SelectItem value="running">Running</SelectItem>
      </SelectContent>
    </Select>
  ),
}
