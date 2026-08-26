import type { Preview } from "@storybook/react-vite"

import "../src/styles/globals.css"

const preview: Preview = {
  decorators: [
    (Story) => (
      <div className="dark min-h-screen bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "fullscreen",
    backgrounds: { disable: true },
    controls: { expanded: true },
  },
}

export default preview
