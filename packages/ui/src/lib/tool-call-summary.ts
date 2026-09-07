import type { ToolCallInput } from "@workspace/ui/components/workspace-shell"

export type ToolCallFamily =
  | "read-file"
  | "write-file"
  | "delete-file"
  | "list-files"
  | "diff"
  | "checks"
  | "browser"
  | "checkpoint"
  | "generic"

type ToolPart = {
  name: string
  label?: string
  input: ToolCallInput
}

type GroupableToolEntry = {
  id: string
  kind: string
  tool?: ToolPart & { status: "running" | "completed" | "error" }
}

export type ToolCallGroup<T> = {
  id: string
  kind: "tool-group"
  summary: string
  entries: ReadonlyArray<T>
}

const stringInput = (input: ToolCallInput, key: string) => {
  const value = input[key]
  return value === undefined || value === null ? undefined : String(value)
}

export const toolCallFamily = (name: string): ToolCallFamily => {
  if (name === "workspace_read_file") return "read-file"
  if (name === "workspace_write_file") return "write-file"
  if (name === "workspace_delete_file") return "delete-file"
  if (name === "workspace_list_files") return "list-files"
  if (name === "workspace_diff") return "diff"
  if (name === "workspace_run_checks" || name === "workspace_check_status") {
    return "checks"
  }
  if (name === "workspace_browser") return "browser"
  if (name === "workspace_checkpoint") return "checkpoint"
  return "generic"
}

export const toolCallLabel = ({ name, input, label }: ToolPart): string => {
  if (label) return label
  const path = stringInput(input, "path") ?? stringInput(input, "filePath")
  if (name === "read" || name === "workspace_read_file")
    return path ? `Read ${path}` : "Read file"
  if (name === "write" || name === "workspace_write_file") {
    return path ? `Wrote ${path}` : "Wrote file"
  }
  if (name === "edit") return path ? `Edited ${path}` : "Edited file"
  if (name === "patch" || name === "apply_patch") return "Applied patch"
  if (name === "grep") return "Searched file contents"
  if (name === "glob") return "Found matching files"
  if (name === "shell" || name === "bash") return "Ran command"
  if (name === "workspace_delete_file") {
    return path ? `Deleted ${path}` : "Deleted file"
  }
  if (name === "workspace_list_files") {
    const directory = stringInput(input, "directory")
    return directory ? `Listed files in ${directory}` : "Listed files"
  }
  if (name === "workspace_diff") {
    return stringInput(input, "scope") === "checkpoint"
      ? "Diff since base commit"
      : "Diff of working changes"
  }
  if (name === "workspace_run_checks") return "Ran checks"
  if (name === "workspace_check_status") return "Read check status"
  if (name === "workspace_checkpoint") {
    const message = stringInput(input, "message")
    return message ? `Checkpoint: ${message}` : "Created checkpoint"
  }
  if (name === "workspace_sync_project") return "Synced Project Repository"
  if (name === "workspace_request_merge") return "Requested merge"
  if (name === "workspace_preview") return "Opened Preview"
  if (name === "workspace_production") return "Read production deployments"
  if (name === "workspace_browser") {
    const target = path ?? stringInput(input, "url")
    return target
      ? `Opened ${target} in the Preview`
      : "Opened the Preview in the browser"
  }
  if (name === "skill_read_resource") {
    return path ? `Read Skill resource ${path}` : "Read Skill resource"
  }
  return name.replaceAll("_", " ")
}

const toolAction = (name: string) => {
  if (
    [
      "read",
      "glob",
      "grep",
      "workspace_read_file",
      "workspace_list_files",
      "skill_read_resource",
    ].includes(name)
  )
    return "inspection"
  if (
    [
      "write",
      "edit",
      "patch",
      "apply_patch",
      "workspace_write_file",
      "workspace_delete_file",
    ].includes(name)
  )
    return "changes"
  if (name === "shell" || name === "bash") return "commands"
  return undefined
}

const summarizeTools = <T extends GroupableToolEntry>(
  entries: ReadonlyArray<T>
) => {
  const action = toolAction(entries[0]?.tool?.name ?? "")
  if (action === "commands") return `Ran ${entries.length} commands`
  if (action === "changes") return `Made ${entries.length} file changes`
  const reads = entries.filter((entry) =>
    ["read", "workspace_read_file", "skill_read_resource"].includes(
      entry.tool?.name ?? ""
    )
  ).length
  const searches = entries.length - reads
  if (searches === 0) return `Inspected files · ${reads} reads`
  if (reads === 0) return `Searched workspace · ${searches} searches`
  return `Inspected workspace · ${reads} ${reads === 1 ? "read" : "reads"}, ${searches} ${searches === 1 ? "search" : "searches"}`
}

export const groupToolCalls = <T extends GroupableToolEntry>(
  entries: ReadonlyArray<T>
): Array<T | ToolCallGroup<T>> => {
  const grouped: Array<T | ToolCallGroup<T>> = []
  let run: T[] = []

  const flush = () => {
    if (run.length >= 2) {
      grouped.push({
        id: `tool-group:${run[0]?.id}`,
        kind: "tool-group",
        summary: summarizeTools(run),
        entries: run,
      })
    } else {
      grouped.push(...run)
    }
    run = []
  }

  for (const entry of entries) {
    const action = toolAction(entry.tool?.name ?? "")
    if (
      entry.kind === "tool" &&
      entry.tool?.status === "completed" &&
      action !== undefined
    ) {
      if (run.length > 0 && action !== toolAction(run[0]?.tool?.name ?? ""))
        flush()
      run.push(entry)
      continue
    }
    flush()
    grouped.push(entry)
  }
  flush()
  return grouped
}
