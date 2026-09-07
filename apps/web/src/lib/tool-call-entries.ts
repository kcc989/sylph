import {
  WorkspaceBrowserToolOutput,
  WorkspaceBrowserToolInput,
  WorkspaceCheckRun,
  WorkspaceCheckRunList,
  WorkspaceDiffResult,
  type WorkspaceMessageToolPart,
} from "@workspace/domain"
import type {
  ToolCallDetail,
  ToolCallEntry,
} from "@workspace/ui/components/workspace-shell"
import { Option, Schema } from "effect"

type ToolCallFile = ToolCallEntry["files"][number]

const decodeWorkspaceDiff = Schema.decodeUnknownOption(
  Schema.fromJsonString(WorkspaceDiffResult)
)
const decodeWorkspaceBrowserOutput = Schema.decodeUnknownOption(
  Schema.fromJsonString(WorkspaceBrowserToolOutput)
)
const decodeWorkspaceBrowserInput = Schema.decodeUnknownOption(
  WorkspaceBrowserToolInput
)
const decodeWorkspaceCheckRun = Schema.decodeUnknownOption(
  Schema.fromJsonString(WorkspaceCheckRun)
)
const decodeWorkspaceCheckRuns = Schema.decodeUnknownOption(
  Schema.fromJsonString(WorkspaceCheckRunList)
)

const diffDetail = (output: string): ToolCallDetail | undefined => {
  const decoded = decodeWorkspaceDiff(output)
  if (Option.isNone(decoded)) return undefined
  return {
    kind: "diff",
    files: decoded.value.files.map((file) => ({
      file: file.file,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    })),
  }
}

const browserDetail = (output: string): ToolCallDetail | undefined => {
  const lineEnd = output.indexOf("\n")
  const header = lineEnd === -1 ? output : output.slice(0, lineEnd)
  const decoded = decodeWorkspaceBrowserOutput(header)
  if (Option.isNone(decoded)) return undefined
  const detail: Extract<ToolCallDetail, { kind: "browser" }> = {
    kind: "browser",
    url: decoded.value.url,
    evidence: decoded.value.evidence.map((item) => ({
      id: item.id,
      kind: item.kind,
      label: item.label,
      url: item.url,
    })),
    markdown: lineEnd === -1 ? "" : output.slice(lineEnd + 1),
    accessibility: decoded.value.accessibility,
  }
  if (decoded.value.detail) detail.result = decoded.value.detail
  if (decoded.value.outcome === "failed")
    detail.failure = decoded.value.detail ?? "Browser action failed"
  return detail
}

const browserLabel = (input: WorkspaceMessageToolPart["input"]) => {
  const decoded = decodeWorkspaceBrowserInput(input)
  if (Option.isNone(decoded) || !decoded.value.action) return undefined
  const action = decoded.value.action
  const labels = {
    start: "Started browser session",
    observe: "Observed browser",
    navigate: "Navigated Preview",
    reload: "Reloaded browser",
    close: "Closed browser session",
    click: "Clicked",
    fill: "Filled",
    select: "Selected",
    press: "Pressed key",
    scroll: "Scrolled browser",
    wait: "Waited for",
    assert: "Checked browser assertion",
  }
  const target = "selector" in action ? action.selector : undefined
  return target ? `${labels[action.type]} ${target}` : labels[action.type]
}

const checksDetail = (output: string): ToolCallDetail | undefined => {
  const list = decodeWorkspaceCheckRuns(output)
  const runs = Option.isSome(list)
    ? list.value
    : Option.getOrElse(decodeWorkspaceCheckRun(output), () => undefined)
  if (!runs) return undefined
  const values = Array.isArray(runs) ? runs : [runs]
  return {
    kind: "checks",
    runs: values.map((run) => ({
      id: run.id,
      status: run.status,
      label: `${run.kind === "checkpoint" ? "Checkpoint" : "Production"} check · attempt ${run.attempt}`,
    })),
  }
}

const toolDetail = (
  name: string,
  output: string
): ToolCallDetail | undefined => {
  if (name === "workspace_diff") return diffDetail(output)
  if (name === "workspace_browser") return browserDetail(output)
  if (name === "workspace_run_checks" || name === "workspace_check_status") {
    return checksDetail(output)
  }
  return undefined
}

export const toolCallEntry = (
  part: WorkspaceMessageToolPart
): ToolCallEntry => {
  const detail = toolDetail(part.name, part.output)
  const entry: ToolCallEntry = {
    id: part.id,
    name: part.name,
    status: part.status,
    input: { ...part.input },
    output: part.output,
    outputTruncated: part.outputTruncated,
    files: part.files.map((file) => {
      const result: ToolCallFile = {
        uri: file.uri,
        mime: file.mime,
      }
      if (file.name !== undefined) result.name = file.name
      return result
    }),
    error: part.error,
  }
  if (detail) entry.detail = detail
  if (part.name === "workspace_browser") {
    const label = browserLabel(part.input)
    if (label) entry.label = label
    if (detail?.kind === "browser" && detail.failure) {
      entry.status = "error"
      entry.error = detail.failure
    }
  }
  return entry
}
