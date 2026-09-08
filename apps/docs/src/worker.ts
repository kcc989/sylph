import serverEntry from "@tanstack/react-start/server-entry"

export default {
  fetch: (request: Request) => serverEntry.fetch(request),
} satisfies ExportedHandler
