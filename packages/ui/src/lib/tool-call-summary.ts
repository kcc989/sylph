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
  input: ToolCallInput
}

type GroupableToolEntry = {
  id: string
  kind: string
  tool?: { status: "running" | "completed" | "error" }
}

export type ToolCallGroup<T> = {
  id: string
  kind: "tool-group"
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

export const toolCallLabel = ({ name, input }: ToolPart): string => {
  const path = stringInput(input, "path")
  if (name === "workspace_read_file") return path ? `Read ${path}` : "Read file"
  if (name === "workspace_write_file") {
    return path ? `Wrote ${path}` : "Wrote file"
  }
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

export const groupToolCalls = <T extends GroupableToolEntry>(
  entries: ReadonlyArray<T>
): Array<T | ToolCallGroup<T>> => {
  const grouped: Array<T | ToolCallGroup<T>> = []
  let run: T[] = []

  const flush = () => {
    if (run.length > 5) {
      grouped.push({
        id: `tool-group:${run[0]?.id}:${run.at(-1)?.id}`,
        kind: "tool-group",
        entries: run,
      })
    } else {
      grouped.push(...run)
    }
    run = []
  }

  for (const entry of entries) {
    if (
      entry.kind === "tool" &&
      entry.tool !== undefined &&
      entry.tool.status !== "running"
    ) {
      run.push(entry)
      continue
    }
    flush()
    grouped.push(entry)
  }
  flush()
  return grouped
}
