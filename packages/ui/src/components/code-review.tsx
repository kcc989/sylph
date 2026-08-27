"use client"

import { PatchDiff } from "@pierre/diffs/react"

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

type CodeReviewProps = {
  patch: string
  className?: string
  split?: boolean
}

const splitFilePatches = (patch: string) =>
  patch
    .split(/(?=^diff --git )/m)
    .map((filePatch) => filePatch.trim())
    .filter(Boolean)

function CodeReview({ patch, className, split }: CodeReviewProps) {
  const filePatches = splitFilePatches(patch)

  return (
    <div
      aria-label="Code changes"
      className={cn("min-w-0 overflow-auto bg-[#11100f]", className)}
      tabIndex={0}
    >
      {filePatches.map((filePatch) => (
        <PatchDiff
          key={filePatch}
          patch={filePatch}
          disableWorkerPool
          options={{
            themeType: "dark",
            theme: "github-dark-default",
            diffStyle: split ? "split" : "unified",
            diffIndicators: "bars",
            hunkSeparators: "line-info-basic",
            overflow: "wrap",
            stickyHeader: true,
          }}
        />
      ))}
    </div>
  )
}

export { CodeReview, defaultPatch, splitFilePatches }
