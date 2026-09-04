"use client"

import { useStore, type Store } from "@tanstack/react-store"
import {
  createContext,
  type ReactNode,
  useContext,
  useRef,
  useState,
} from "react"
import {
  type PanelImperativeHandle,
  useDefaultLayout,
} from "react-resizable-panels"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { cn } from "@workspace/ui/lib/utils"

import { ShellContent } from "./shell-content"
import {
  createShellStore,
  setMobileNavigationOpen,
  setNavigationCollapsed,
  type ShellState,
  type ShellStorage,
} from "./shell-store"

type ShellContextValue = {
  closeNavigation: () => void
  navigationCollapsed: boolean
  openNavigation: () => void
}

const ShellContext = createContext<ShellContextValue | null>(null)

const browserStorage = (): ShellStorage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const layoutStorage = {
  getItem: (name: string) => browserStorage()?.getItem(name) ?? null,
  setItem: (name: string, value: string) => {
    try {
      browserStorage()?.setItem(name, value)
    } catch {
      return
    }
  },
}

export type ShellRootProps = {
  children: ReactNode
  className?: string
  initiallyCollapsed?: boolean
  navigation: ReactNode
  productRail: ReactNode
  showHeader?: boolean
  topbar?: ReactNode
}

const useShellState = <T,>(
  store: Store<ShellState>,
  selector: (state: ShellState) => T
) => useStore(store, selector)

export function ShellRoot({
  children,
  className,
  initiallyCollapsed = false,
  navigation,
  productRail,
  showHeader = true,
  topbar,
}: ShellRootProps) {
  const [store] = useState(() =>
    createShellStore(initiallyCollapsed, browserStorage())
  )
  const navigationCollapsed = useShellState(
    store,
    (state) => state.navigationCollapsed
  )
  const mobileNavigationOpen = useShellState(
    store,
    (state) => state.mobileNavigationOpen
  )
  const navigationRef = useRef<PanelImperativeHandle>(null)
  const layout = useDefaultLayout({
    id: "sylph:shell-navigation:v1",
    onlySaveAfterUserInteractions: true,
    panelIds: ["project-navigation", "workspace-area"],
    storage: layoutStorage,
  })

  const collapseNavigation = () => {
    if (!window.matchMedia("(min-width: 768px)").matches) {
      setMobileNavigationOpen(store, false)
      return
    }
    navigationRef.current?.collapse()
    setNavigationCollapsed(store, true, browserStorage())
  }

  const openNavigation = () => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setMobileNavigationOpen(store, false)
      navigationRef.current?.expand()
      setNavigationCollapsed(store, false, browserStorage())
      return
    }
    setMobileNavigationOpen(store, true)
  }

  return (
    <ShellContext
      value={{
        closeNavigation: collapseNavigation,
        navigationCollapsed,
        openNavigation,
      }}
    >
      <div
        className={cn(
          "dark flex h-svh min-h-0 overflow-hidden bg-background text-foreground",
          className
        )}
      >
        {productRail}
        <ResizablePanelGroup
          className={cn(
            "min-w-0 flex-1 max-md:[&>#project-navigation]:hidden max-md:[&>#project-navigation-handle]:hidden",
            navigationCollapsed &&
              "md:[&>#project-navigation]:hidden! md:[&>#workspace-area]:flex-1!"
          )}
          defaultLayout={layout.defaultLayout}
          id="app-shell-navigation"
          onLayoutChanged={layout.onLayoutChanged}
          orientation="horizontal"
        >
          <ResizablePanel
            collapsedSize={0}
            collapsible
            defaultSize={navigationCollapsed ? 0 : "268px"}
            groupResizeBehavior="preserve-pixel-size"
            id="project-navigation"
            maxSize="420px"
            minSize="180px"
            onResize={({ inPixels }) => {
              if (!navigationCollapsed)
                setNavigationCollapsed(store, inPixels <= 1, browserStorage())
            }}
            panelRef={navigationRef}
          >
            {navigation}
          </ResizablePanel>
          <ResizableHandle
            aria-label="Resize project navigation"
            className={cn(
              "hidden transition-colors hover:bg-[var(--sylph-coral)]/50 md:flex",
              navigationCollapsed && "md:hidden"
            )}
            id="project-navigation-handle"
          />
          <ResizablePanel
            className="max-md:fixed! max-md:inset-0! max-md:w-auto! max-md:max-w-none! max-md:min-w-0! max-md:basis-auto!"
            id="workspace-area"
            minSize="480px"
          >
            <ShellContent
              navigationCollapsed={navigationCollapsed}
              onOpenNavigation={openNavigation}
              showHeader={showHeader}
              topbar={topbar}
            >
              {children}
            </ShellContent>
          </ResizablePanel>
        </ResizablePanelGroup>
        {mobileNavigationOpen ? (
          <div className="fixed inset-0 z-50 flex bg-black/55 md:hidden">
            <div className="h-full w-[268px] border-r bg-sidebar">
              {navigation}
            </div>
            <button
              aria-label="Close navigation"
              className="flex-1"
              onClick={() => setMobileNavigationOpen(store, false)}
              type="button"
            />
          </div>
        ) : null}
      </div>
    </ShellContext>
  )
}

export const useShell = () => {
  const value = useContext(ShellContext)
  if (!value) throw new Error("useShell must be used within ShellRoot")
  return value
}

export const useOptionalShell = () => useContext(ShellContext)
