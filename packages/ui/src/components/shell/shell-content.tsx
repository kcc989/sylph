import { PanelLeftOpen } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

export function ShellContent({
  children,
  navigationCollapsed,
  onOpenNavigation,
  showHeader = true,
  topbar,
}: {
  children: ReactNode
  navigationCollapsed: boolean
  onOpenNavigation: () => void
  showHeader?: boolean
  topbar?: ReactNode
}) {
  return (
    <div className="flex size-full min-w-0 flex-col overflow-hidden">
      {showHeader ? (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
          <Button
            aria-label="Open navigation"
            className={cn(!navigationCollapsed && "md:hidden")}
            onClick={onOpenNavigation}
            size="icon-sm"
            variant="ghost"
          >
            <PanelLeftOpen />
          </Button>
          <div className="min-w-0 flex-1">{topbar}</div>
        </header>
      ) : null}
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </div>
  )
}
