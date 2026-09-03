import type { Meta, StoryObj } from "@storybook/react-vite"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs"

const meta = { title: "Primitives/Tabs", component: Tabs } satisfies Meta<
  typeof Tabs
>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <Tabs defaultValue="checks">
      <TabsList>
        <TabsTrigger value="checks">Checks</TabsTrigger>
        <TabsTrigger value="review">Review</TabsTrigger>
      </TabsList>
      <TabsContent value="checks">All checks passed.</TabsContent>
      <TabsContent value="review">Ready for review.</TabsContent>
    </Tabs>
  ),
}
