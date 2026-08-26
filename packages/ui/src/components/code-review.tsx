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

function CodeReview({ patch, className, split }: CodeReviewProps) {
  return (
    <div
      aria-label="Code changes"
      className={cn("min-w-0 overflow-auto bg-[#11100f]", className)}
      tabIndex={0}
    >
      <PatchDiff
        patch={patch}
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
    </div>
  )
}

export { CodeReview, defaultPatch }
