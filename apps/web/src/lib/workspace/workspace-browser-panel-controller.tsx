import { useServerFn } from "@tanstack/react-start"
import type { ComponentProps } from "react"

import {
  configureWorkspaceBrowser,
  controlWorkspaceBrowser,
  exceptWorkspaceBrowser,
} from "@/functions/workspaces"
import { WorkspaceBrowserPanelView } from "./workspace-browser-panel"

export function WorkspaceBrowserPanel(
  props: Omit<
    ComponentProps<typeof WorkspaceBrowserPanelView>,
    "control" | "configure" | "except"
  >
) {
  return (
    <WorkspaceBrowserPanelView
      {...props}
      control={useServerFn(controlWorkspaceBrowser)}
      configure={useServerFn(configureWorkspaceBrowser)}
      except={useServerFn(exceptWorkspaceBrowser)}
    />
  )
}
