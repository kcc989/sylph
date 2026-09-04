"use client"

import { PatchDiff, type SelectedLineRange } from "@pierre/diffs/react"
import { Plus } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

const defaultPatch = `diff --git a/apps/web/src/routes/workspaces/$workspaceId.tsx b/apps/web/src/routes/workspaces/$workspaceId.tsx
index 33fae1d..bfd041e 100644
--- a/apps/web/src/routes/workspaces/$workspaceId.tsx
+++ b/apps/web/src/routes/workspaces/$workspaceId.tsx
@@ -18,7 +18,9 @@ function WorkspaceScreen() {
-  return <WorkspacePlaceholder workspace={workspace} />
+  return (
+    <WorkspaceShell workspace={workspace} />
+  )
 }`

const commentGutterStyles = `
[data-column-number] {
  padding-right: calc(1ch + 1lh + 4px);
}
`

type CodeReviewProps = {
  patch: string
  className?: string
  split?: boolean
  annotations?: ReadonlyArray<CodeReviewAnnotation>
  selectedLines?: CodeReviewSelection | null
  onLineSelected?: (selection: CodeReviewSelection | null) => void
  renderAnnotation?: (annotation: CodeReviewAnnotation) => ReactNode
}

type CodeReviewSide = "additions" | "deletions"

type CodeReviewSelection = SelectedLineRange & {
  file: string
}

type CodeReviewAnnotation = {
  id: string
  file: string
  side: CodeReviewSide
  lineNumber: number
}

const splitFilePatches = (patch: string) =>
  patch
    .split(/(?=^diff --git )/m)
    .map((filePatch) => filePatch.trim())
    .filter(Boolean)

const patchFilePath = (patch: string) => {
  const addition = patch.match(/^\+\+\+ b\/(.+)$/m)?.[1]
  if (addition) return addition
  return patch.match(/^--- a\/(.+)$/m)?.[1] ?? "Unknown file"
}

function CodeReview({
  patch,
  className,
  split,
  annotations = [],
  selectedLines,
  onLineSelected,
  renderAnnotation,
}: CodeReviewProps) {
  const filePatches = splitFilePatches(patch)

  return (
    <div
      aria-label="Code changes"
      className={cn("min-w-0 overflow-auto bg-[#11100f]", className)}
      tabIndex={0}
    >
      {filePatches.map((filePatch) => {
        const file = patchFilePath(filePatch)
        const fileAnnotations = annotations.filter(
          (annotation) => annotation.file === file
        )

        return (
          <PatchDiff<CodeReviewAnnotation>
            key={filePatch}
            patch={filePatch}
            disableWorkerPool
            lineAnnotations={fileAnnotations.map((annotation) => ({
              side: annotation.side,
              lineNumber: annotation.lineNumber,
              metadata: annotation,
            }))}
            options={{
              themeType: "dark",
              theme: "pierre-dark",
              diffStyle: split ? "split" : "unified",
              diffIndicators: "bars",
              enableGutterUtility: Boolean(onLineSelected),
              enableLineSelection: Boolean(onLineSelected),
              hunkSeparators: "line-info-basic",
              lineHoverHighlight: onLineSelected ? "both" : "disabled",
              onLineSelected: (range) =>
                onLineSelected?.(range ? { ...range, file } : null),
              overflow: "wrap",
              stickyHeader: true,
              unsafeCSS: onLineSelected ? commentGutterStyles : undefined,
            }}
            renderAnnotation={(annotation) =>
              renderAnnotation?.(annotation.metadata)
            }
            renderGutterUtility={(getHoveredLine) => (
              <button
                aria-label={`Add a comment to ${file}`}
                className="grid size-5 place-items-center rounded-[3px] bg-[var(--sylph-coral)] text-[#201d19] shadow-[0_2px_6px_rgba(0,0,0,.28)] focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
                onClick={() => {
                  const line = getHoveredLine()
                  if (!line) return
                  onLineSelected?.({
                    file,
                    start: line.lineNumber,
                    end: line.lineNumber,
                    side: line.side,
                    endSide: line.side,
                  })
                }}
                type="button"
              >
                <Plus className="size-3" />
              </button>
            )}
            selectedLines={
              selectedLines?.file === file ? selectedLines : undefined
            }
          />
        )
      })}
    </div>
  )
}

export {
  CodeReview,
  defaultPatch,
  patchFilePath,
  splitFilePatches,
  type CodeReviewAnnotation,
  type CodeReviewSelection,
  type CodeReviewSide,
}
