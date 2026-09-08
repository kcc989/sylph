import { expect, test } from "bun:test"
import { rolldown } from "rolldown"

const viewer = new URL(
  "../../packages/ui/src/components/code-viewer.tsx",
  import.meta.url
).pathname

test("server code viewer excludes the interactive highlighter", async () => {
  const build = await rolldown({
    input: viewer,
    external: ["react", "react/jsx-runtime"],
    transform: { define: { "import.meta.env.SSR": "true" } },
  })
  try {
    const bundle = await build.generate({ format: "esm" })
    const modules = bundle.output.flatMap((output) =>
      output.type === "chunk" ? output.moduleIds : []
    )
    expect(modules.some((id) => id.includes("code-viewer.tsx"))).toBe(true)
    expect(modules.filter((id) => id.includes("@pierre/diffs"))).toEqual([])
    expect(modules.filter((id) => id.includes("shiki"))).toEqual([])
  } finally {
    await build.close()
  }
})
