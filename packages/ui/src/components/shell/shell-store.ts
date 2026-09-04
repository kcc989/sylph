import { Store } from "@tanstack/react-store"

export type ShellState = {
  mobileNavigationOpen: boolean
  navigationCollapsed: boolean
}

export type ShellStorage = Pick<Storage, "getItem" | "setItem">

const storageKey = "sylph:shell-navigation:v1:collapsed"

const readCollapsed = (storage: ShellStorage | null, fallback: boolean) => {
  if (!storage) return fallback

  try {
    const value = storage.getItem(storageKey)
    return value === "true" ? true : value === "false" ? false : fallback
  } catch {
    return fallback
  }
}

export const createShellStore = (
  initiallyCollapsed: boolean,
  storage: ShellStorage | null = null
) =>
  new Store<ShellState>({
    mobileNavigationOpen: false,
    navigationCollapsed: readCollapsed(storage, initiallyCollapsed),
  })

export const setNavigationCollapsed = (
  store: Store<ShellState>,
  navigationCollapsed: boolean,
  storage: ShellStorage | null = null
) => {
  store.setState((state) => ({ ...state, navigationCollapsed }))

  if (!storage) return
  try {
    storage.setItem(storageKey, String(navigationCollapsed))
  } catch {
    return
  }
}

export const setMobileNavigationOpen = (
  store: Store<ShellState>,
  mobileNavigationOpen: boolean
) => store.setState((state) => ({ ...state, mobileNavigationOpen }))
