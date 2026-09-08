"use client"

import type { FileProps, PatchDiffProps } from "@pierre/diffs/react"
import { useEffect, useState } from "react"

type CodeViewer = typeof import("@pierre/diffs/react")

const loadViewer = import.meta.env.SSR
  ? null
  : () => import("@pierre/diffs/react")

function useCodeViewer() {
  const [viewer, setViewer] = useState<CodeViewer | null>(null)
  const [failure, setFailure] = useState<Error | null>(null)
  useEffect(() => {
    let active = true
    void loadViewer?.().then(
      (module) => {
        if (active) setViewer(module)
      },
      (cause: unknown) => {
        if (active)
          setFailure(cause instanceof Error ? cause : new Error(String(cause)))
      }
    )
    return () => {
      active = false
    }
  }, [])
  if (failure) throw failure
  return viewer
}

export function File<Annotation>(props: FileProps<Annotation>) {
  const viewer = useCodeViewer()
  return viewer ? (
    <viewer.File {...props} />
  ) : (
    <pre className="overflow-auto text-xs whitespace-pre">
      {props.file.contents}
    </pre>
  )
}

export function PatchDiff<Annotation>(props: PatchDiffProps<Annotation>) {
  const viewer = useCodeViewer()
  return viewer ? (
    <viewer.PatchDiff {...props} />
  ) : (
    <pre className="overflow-auto text-xs whitespace-pre">{props.patch}</pre>
  )
}
