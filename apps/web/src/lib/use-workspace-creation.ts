import { failureMessage } from "@workspace/domain"
import { useServerFn } from "@tanstack/react-start"
import { useState } from "react"

import { createWorkspace } from "@/functions/workspaces"

type WorkspaceProject = {
  id: string
  slug: string
}

export function useWorkspaceCreation() {
  const create = useServerFn(createWorkspace)
  const [creatingProjectId, setCreatingProjectId] = useState<string | null>(
    null
  )
  const [creationError, setCreationError] = useState<{
    projectId: string
    message: string
  } | null>(null)

  const startWorkspace = async (project: WorkspaceProject) => {
    if (creatingProjectId) return

    setCreatingProjectId(project.id)
    setCreationError(null)

    try {
      const result = await create({ data: { projectId: project.id } })
      window.location.assign(
        `/projects/${encodeURIComponent(project.slug)}/workspaces/${encodeURIComponent(result.id)}`
      )
    } catch (cause) {
      setCreationError({
        projectId: project.id,
        message: failureMessage(cause, "The Workspace could not be created"),
      })
      setCreatingProjectId(null)
    }
  }

  return { creatingProjectId, creationError, startWorkspace }
}
