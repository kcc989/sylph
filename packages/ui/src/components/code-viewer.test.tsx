import { describe, expect, test } from "bun:test"
import { renderToString } from "react-dom/server"
import { File, PatchDiff } from "./code-viewer"

describe("code viewer server rendering", () => {
  test("renders file contents without the browser highlighter", () => {
    const html = renderToString(
      <File
        file={{ name: "example.ts", contents: "const value = '<script>'" }}
      />
    )
    expect(html).toContain("const value = &#x27;&lt;script&gt;&#x27;")
    expect(html).toContain("<pre")
  })

  test("renders the patch while the interactive viewer loads", () => {
    const patch = "@@ -1 +1 @@\n-old\n+new"
    expect(renderToString(<PatchDiff patch={patch} />)).toContain(patch)
  })
})
