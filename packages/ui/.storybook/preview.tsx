import type { Preview } from "@storybook/react-vite"
import { useEffect, type ComponentType } from "react"

import "../src/styles/globals.css"

function DarkStory({ Story }: { Story: ComponentType }) {
  useEffect(() => {
    document.body.classList.add("dark")
    return () => document.body.classList.remove("dark")
  }, [])
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Story />
    </div>
  )
}

const preview: Preview = {
  decorators: [(Story) => <DarkStory Story={Story} />],
  parameters: {
    layout: "fullscreen",
    backgrounds: { disable: true },
    controls: { expanded: true },
  },
}

export default preview
