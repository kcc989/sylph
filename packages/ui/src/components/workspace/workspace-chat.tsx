"use client"

import {
  AgentThread,
  type AgentThreadProps,
} from "./workspace-thread/agent-thread"
import {
  useWorkspaceShell,
  useWorkspaceShellStore,
} from "./workspace-shell-provider"
import {
  inspectWorkspaceActivity,
  openWorkspaceTool,
} from "./workspace-shell-store"

type WorkspaceChatProps = Omit<
  AgentThreadProps,
  | "references"
  | "onRemoveReference"
  | "onOpenFiles"
  | "onInspectActivity"
  | "onOpenEvidence"
>

export function WorkspaceChat(props: WorkspaceChatProps) {
  const store = useWorkspaceShellStore()
  const references = useWorkspaceShell((state) => state.references)
  const { onSubmitPrompt } = props

  return (
    <section
      aria-label="Workspace conversation"
      className="flex size-full min-w-0 flex-col bg-background"
    >
      <AgentThread
        {...props}
        references={references}
        onRemoveReference={(text) =>
          store.setState((state) => ({
            ...state,
            references: state.references.filter((item) => item.text !== text),
          }))
        }
        onOpenFiles={() => openWorkspaceTool(store, "files")}
        onInspectActivity={(id) => inspectWorkspaceActivity(store, id)}
        onOpenEvidence={(kind) => openWorkspaceTool(store, kind)}
        onSubmitPrompt={
          onSubmitPrompt
            ? async (text, model, delivery) => {
                const sent = await onSubmitPrompt(text, model, delivery)
                if (sent === false) return false
                store.setState((state) => ({
                  ...state,
                  references: state.references.filter(
                    (item) => !references.includes(item)
                  ),
                }))
              }
            : undefined
        }
      />
    </section>
  )
}
