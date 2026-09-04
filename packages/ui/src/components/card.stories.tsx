import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./card"

const meta = { title: "Primitives/Card", component: Card } satisfies Meta<
  typeof Card
>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>An isolated place for agent work.</CardDescription>
      </CardHeader>
      <CardContent>Ready</CardContent>
    </Card>
  ),
}
