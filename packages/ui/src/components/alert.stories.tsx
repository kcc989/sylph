import type { Meta, StoryObj } from "@storybook/react-vite"
import { Alert, AlertDescription, AlertTitle } from "./alert"

const meta = { title: "Primitives/Alert", component: Alert } satisfies Meta<
  typeof Alert
>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <Alert>
      <AlertTitle>Workspace ready</AlertTitle>
      <AlertDescription>The runtime is connected.</AlertDescription>
    </Alert>
  ),
}
