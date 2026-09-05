import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, within } from "storybook/test"
import { useState } from "react"

import { PromptComposer } from "./prompt-composer"

const meta = {
  title: "Workspace/PromptComposer",
  component: PromptComposer,
  args: {
    models: [
      {
        providerId: "openai",
        modelId: "reasoning",
        name: "Reasoning model",
        providerName: "OpenAI",
        scope: "personal",
        variants: ["low", "medium", "high"],
      },
      {
        providerId: "openai",
        modelId: "basic",
        name: "Basic model",
        providerName: "OpenAI",
        scope: "personal",
        variants: [],
      },
    ],
    selectedModel: { providerId: "openai", modelId: "reasoning" },
    skills: [],
    onSubmit: fn(async () => true),
  },
  render: function Composer(args) {
    const [model, setModel] = useState(args.selectedModel)
    return (
      <PromptComposer
        {...args}
        selectedModel={model}
        onModelChange={setModel}
      />
    )
  },
} satisfies Meta<typeof PromptComposer>

export default meta
type Story = StoryObj<typeof meta>

export const Reasoning: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Reasoning level" })
    )
    await userEvent.click(await page.findByRole("option", { name: "High" }))
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Message the agent" }),
      "Build a todo list"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Send message" }))
    await expect(args.onSubmit).toHaveBeenCalledWith(
      "Build a todo list",
      { providerId: "openai", modelId: "reasoning", variant: "high" },
      undefined
    )
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Model for next turn" })
    )
    await userEvent.click(
      await page.findByRole("option", { name: /Basic model/ })
    )
    await expect(
      canvas.getByRole("combobox", { name: "Reasoning level" })
    ).toBeDisabled()
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Model for next turn" })
    )
    await userEvent.click(
      await page.findByRole("option", { name: /Reasoning model/ })
    )
    await expect(
      canvas.getByRole("combobox", { name: "Reasoning level" })
    ).toHaveTextContent("High")
  },
}

export const ActiveTurn: Story = {
  args: {
    turnActive: true,
    selectedModel: {
      providerId: "openai",
      modelId: "reasoning",
      variant: "medium",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("combobox", { name: "Model for next turn" })
    ).toBeDisabled()
    await expect(
      canvas.getByRole("combobox", { name: "Reasoning level" })
    ).toBeDisabled()
    await expect(
      canvas.getByRole("combobox", { name: "Reasoning level" })
    ).toHaveTextContent("Medium")
  },
}
