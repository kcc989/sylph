import { useServerFn } from "@tanstack/react-start"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  getWorkspace,
  getWorkspaceActivity,
  getWorkspaceChecks,
} from "@/functions/workspaces"
import { createWorkspaceRefreshQueue } from "./workspace-refresh"

type WorkspaceResult = Awaited<ReturnType<typeof getWorkspace>>

export const useWorkspaceData = (initial: WorkspaceResult) => {
  const [result, setResult] = useState(initial)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const generation = useRef(0)
  const active = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const readWorkspace = useServerFn(getWorkspace)
  const readActivity = useServerFn(getWorkspaceActivity)
  const readChecks = useServerFn(getWorkspaceChecks)
  const workspaceId = initial.workspace.id
  const currentWorkspaceId = useRef(workspaceId)
  currentWorkspaceId.current = workspaceId

  useEffect(() => {
    generation.current += 1
    setResult(initial)
    setRefreshError(null)
    return () => {
      generation.current += 1
    }
  }, [initial])

  const refresh = useMemo(
    () =>
      createWorkspaceRefreshQueue(async (scope) => {
        if (!active.current || currentWorkspaceId.current !== workspaceId)
          return
        const currentGeneration = generation.current
        try {
          if (scope === "checks") {
            const checks = await readChecks({ data: { workspaceId } })
            if (
              generation.current === currentGeneration &&
              currentWorkspaceId.current === workspaceId
            )
              setResult((current) => ({ ...current, checks }))
          } else if (scope === "runtime") {
            const runtime = await readActivity({ data: { workspaceId } })
            if (
              generation.current === currentGeneration &&
              currentWorkspaceId.current === workspaceId
            )
              setResult((current) => ({ ...current, runtime }))
          } else {
            const next = await readWorkspace({
              data: { workspaceId, includeOptions: false },
            })
            if (
              generation.current === currentGeneration &&
              currentWorkspaceId.current === workspaceId
            )
              setResult((current) => ({
                ...next,
                models: current.models,
                selectedModel: current.selectedModel,
                modelNotice: current.modelNotice,
                skills: current.skills,
              }))
          }
          if (
            generation.current === currentGeneration &&
            currentWorkspaceId.current === workspaceId
          )
            setRefreshError(null)
        } catch {
          if (
            generation.current === currentGeneration &&
            currentWorkspaceId.current === workspaceId
          )
            setRefreshError(
              "Live updates paused. Reconnect or reload this Workspace."
            )
        }
      }),
    [readActivity, readChecks, readWorkspace, workspaceId]
  )

  useEffect(() => {
    if (
      result.workspace.status !== "provisioning" &&
      result.workspace.status !== "merging"
    )
      return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      await refresh("workspace")
      if (!stopped) timer = setTimeout(poll, 1000)
    }
    timer = setTimeout(poll, 1000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [refresh, result.workspace.status])

  const current = result.workspace.id === workspaceId ? result : initial
  const currentModel = current.models.find(
    (model) => `${model.providerId}/${model.modelId}` === current.runtime.model
  )
  const models = current.models.map((model) => ({
    ...model,
    thinkingOptions:
      current.runtime.availableModels?.find(
        (available) =>
          available.providerId === model.providerId &&
          available.modelId === model.modelId
      )?.thinkingOptions ?? [],
    variants:
      current.runtime.availableModels?.find(
        (available) =>
          available.providerId === model.providerId &&
          available.modelId === model.modelId
      )?.variants ?? model.variants,
  }))

  return {
    result: {
      ...current,
      models,
      selectedModel: currentModel
        ? {
            providerId: currentModel.providerId,
            modelId: currentModel.modelId,
            variant: current.runtime.modelVariant,
          }
        : current.selectedModel,
    },
    refresh,
    refreshError,
  }
}
