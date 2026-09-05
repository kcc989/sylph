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
        thinkingOptions: ["low", "medium", "high"].map((value) => ({
          value,
          label: value.replace(/^./, (letter) => letter.toUpperCase()),
          kind: "effort" as const,
        })),
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
      canvas.getByRole("combobox", { name: "Model and thinking settings" })
    )
    await userEvent.click(await page.findByText("Effort", { exact: true }))
    await userEvent.click(page.getByRole("radio", { name: "High" }))
    await expect(page.getByRole("radio", { name: "High" })).toBeChecked()
    await userEvent.keyboard("{Escape}")
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
      canvas.getByRole("combobox", { name: "Model and thinking settings" })
    )
    await userEvent.click(
      await page.findByRole("option", { name: /Basic model/ })
    )
    await expect(
      canvas.getByRole("combobox", { name: "Model and thinking settings" })
    ).not.toHaveTextContent("High")
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Model and thinking settings" })
    )
    await userEvent.click(
      await page.findByRole("option", { name: /Reasoning model/ })
    )
    await expect(
      canvas.getByRole("combobox", { name: "Model and thinking settings" })
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
    const picker = within(canvasElement).getByRole("combobox", {
      name: "Model and thinking settings",
    })
    await expect(picker).toBeDisabled()
    await expect(picker).toHaveTextContent("Medium")
  },
}

export const ThinkingToggle: Story = {
  args: {
    models: [
      {
        providerId: "openrouter",
        modelId: "nemotron",
        name: "Nemotron 3.5 Lightning (free)",
        providerName: "OpenRouter",
        scope: "personal",
        thinkingOptions: [
          { value: "none", label: "Off", kind: "toggle" },
          { value: "thinking", label: "On", kind: "toggle" },
        ],
      },
    ],
    selectedModel: { providerId: "openrouter", modelId: "nemotron" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Model and thinking settings" })
    )
    await userEvent.click(await page.findByText("Thinking", { exact: true }))
    await userEvent.click(page.getByRole("radio", { name: "On" }))
    await expect(page.getByRole("radio", { name: "On" })).toBeChecked()
    await expect(page.queryByRole("radio", { name: "High" })).toBeNull()
    await userEvent.keyboard("{Escape}")
  },
}

export const NarrowComposer: Story = {
  ...ThinkingToggle,
  decorators: [
    (Story) => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
  args: { ...ThinkingToggle.args, onOpenFiles: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const send = canvas
      .getByRole("button", { name: "Send message" })
      .getBoundingClientRect()
    const picker = canvas
      .getByRole("combobox", { name: "Model and thinking settings" })
      .getBoundingClientRect()
    await expect(Math.abs(send.y - picker.y)).toBeLessThan(8)
    await expect(send.right).toBeLessThanOrEqual(
      canvasElement.getBoundingClientRect().right
    )
  },
}
