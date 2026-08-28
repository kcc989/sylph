import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/projects/$projectSlug/workspaces/new")({
  beforeLoad: () => {
    throw redirect({ to: "/" })
  },
  component: () => null,
})
