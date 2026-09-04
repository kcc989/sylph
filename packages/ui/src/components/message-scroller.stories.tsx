import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./message-scroller"

const meta = {
  title: "Primitives/Message scroller",
  component: MessageScroller,
} satisfies Meta<typeof MessageScroller>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  render: () => (
    <MessageScrollerProvider>
      <MessageScroller className="h-72 w-96">
        <MessageScrollerViewport>
          <MessageScrollerContent>
            {Array.from({ length: 12 }, (_, index) => (
              <MessageScrollerItem key={index} messageId={`message-${index}`}>
                Message {index + 1}
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  ),
}
