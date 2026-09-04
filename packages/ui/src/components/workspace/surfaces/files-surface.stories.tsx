import type { Meta, StoryObj } from "@storybook/react-vite"

import { FilesSurface } from "./files-surface"

const source = `import { betterAuth } from "better-auth"

export const createAuth = (baseURL: string, secret: string) =>
  betterAuth({
    baseURL,
    secret,
    emailAndPassword: {
      enabled: true,
    },
  })
`

const contents = new Map([
  ["src/server/auth.ts", source],
  ["package.json", '{\n  "name": "todo-app",\n  "private": true\n}\n'],
  ["empty.ts", ""],
  [
    "notes.custom",
    "Plain text remains readable for unknown file extensions.\n",
  ],
])

const meta = {
  title: "Workspace/Files",
  component: FilesSurface,
  decorators: [
    (Story) => (
      <div className="h-[620px]">
        <Story />
      </div>
    ),
  ],
  args: {
    files: [...contents.keys()],
    fileChanges: [],
    onReadFile: async (path) => ({
      path,
      content: contents.get(path) ?? null,
      encoding: "utf8",
      size: contents.get(path)?.length ?? 0,
      updatedAt: 0,
    }),
  },
} satisfies Meta<typeof FilesSurface>

export default meta

type Story = StoryObj<typeof FilesSurface>

export const FileViewer: Story = {}

export const EmptyWorkspace: Story = {
  args: { files: [] },
}

export const BinaryFile: Story = {
  args: {
    files: ["logo.png"],
    onReadFile: async (path) => ({
      path,
      content: null,
      encoding: "binary",
      size: 1024,
      updatedAt: 0,
    }),
  },
}
