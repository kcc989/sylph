import serverEntry from "@tanstack/react-start/server-entry"

import { refreshProviderCatalogs } from "@/server/provider-catalog-refresh"

export { WorkspaceMerge } from "./server/workspace-merge"
export { WorkspaceRetention } from "./server/workspace-retention"

export default {
  fetch: serverEntry.fetch,
  async scheduled() {
    const result = await refreshProviderCatalogs()
    console.info("Provider catalog refresh completed", result)
  },
}
