import type { Meta, StoryObj } from "@storybook/react-vite"
import { ModelCombobox } from "./model-combobox"

const models = [
  {
    providerId: "openai",
    modelId: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    providerName: "OpenAI",
    scope: "personal",
  },
  {
    providerId: "anthropic",
    modelId: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    providerName: "Anthropic",
    scope: "organization",
  },
]
const meta = {
  title: "Primitives/Model combobox",
  component: ModelCombobox,
  args: { ariaLabel: "Model", models, value: models[0] },
} satisfies Meta<typeof ModelCombobox>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
