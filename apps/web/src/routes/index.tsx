import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  ArrowRight,
  Boxes,
  Building2,
  CircleDot,
  Code2,
  LogOut,
  Mail,
  Plus,
} from "lucide-react"
import { type ComponentProps, type FormEvent, useState } from "react"

import { authClient } from "@/lib/auth-client"
import { getDashboard, getLatestMagicLink } from "@/lib/workspaces"

export const Route = createFileRoute("/")({
  loader: () => getDashboard(),
  component: WorkspaceLab,
})

function WorkspaceLab() {
  const dashboard = Route.useLoaderData()
  const router = useRouter()
  const loadLatestMagicLink = useServerFn(getLatestMagicLink)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [magicLink, setMagicLink] = useState<string | null>(null)

  const handleMagicLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setMessage(null)
    setMagicLink(null)
    const form = new FormData(event.currentTarget)
    const email = String(form.get("email"))
    const result = await authClient.signIn.magicLink({
      email,
      name: email.split("@")[0],
      callbackURL: "/",
      errorCallbackURL: "/",
    })

    if (result.error) {
      setPending(false)
      setMessage(result.error.message ?? "Authentication failed")
      return
    }

    const localLink = await loadLatestMagicLink({ data: { email } })
    setMagicLink(localLink)
    setMessage("Magic link created. In production, the mailer sends this link.")
    setPending(false)
  }

  return (
    <main className="min-h-svh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Boxes className="size-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">Sylph Workspace Lab</h1>
              <p className="text-xs text-muted-foreground">
                Better Auth organizations · Artifacts repos · OpenCode v2
              </p>
            </div>
          </div>
          {dashboard.user ? (
            <div className="flex items-center gap-3">
              <Link
                to="/organizations"
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Organizations
              </Link>
              <span className="hidden text-xs text-muted-foreground sm:block">
                {dashboard.user.email}
              </span>
              <Button
                variant="outline"
                onClick={async () => {
                  await authClient.signOut()
                  await router.invalidate()
                }}
              >
                <LogOut /> Sign out
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      {!dashboard.user ? (
        <div className="mx-auto max-w-md px-5 py-12">
          <Card>
            <CardHeader>
              <CardTitle>Sign in to Sylph</CardTitle>
              <CardDescription>
                Use a magic link or continue with GitHub.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={handleMagicLink}>
                <Field
                  label="Email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                />
                <Button type="submit" disabled={pending}>
                  <Mail /> Send magic link
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    authClient.signIn.social({
                      provider: "github",
                      callbackURL: "/",
                    })
                  }
                >
                  <Code2 /> Continue with GitHub
                </Button>
                {magicLink ? (
                  <a
                    href={magicLink}
                    className="rounded-lg border border-dashed p-3 text-center text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Open local test magic link
                  </a>
                ) : null}
              </form>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="mx-auto grid max-w-6xl gap-5 px-5 py-8 lg:grid-cols-[320px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-4" /> Organizations
              </CardTitle>
              <CardDescription>
                {dashboard.organizations.length} organization
                {dashboard.organizations.length === 1 ? "" : "s"}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Button
                nativeButton={false}
                render={<Link to="/organizations" />}
              >
                View organizations <ArrowRight />
              </Button>
              <Button
                nativeButton={false}
                variant="outline"
                render={<Link to="/organizations/new" />}
              >
                <Plus /> New organization
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Projects</CardTitle>
              <CardDescription>
                Each Project contains a Repository and durable OpenCode
                Workspaces.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {dashboard.projects.length ? (
                <div className="divide-y">
                  {dashboard.projects.map((project) => {
                    const workspaces = dashboard.workspaces.filter(
                      (workspace) => workspace.projectId === project.id
                    )

                    return (
                      <section key={project.id} className="px-5 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {project.name}
                            </p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              Repository · {project.repositoryName}
                            </p>
                          </div>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {workspaces.length} Workspace
                            {workspaces.length === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="mt-3 grid gap-1">
                          {workspaces.map((workspace) => (
                            <Link
                              key={workspace.id}
                              to="/workspaces/$workspaceId"
                              params={{ workspaceId: workspace.id }}
                              className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs hover:bg-muted"
                            >
                              <CircleDot className="size-3.5 text-emerald-500" />
                              <span className="min-w-0 flex-1 truncate">
                                {workspace.title}
                              </span>
                              <span className="text-muted-foreground">
                                {workspace.status}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </section>
                    )
                  })}
                </div>
              ) : (
                <div className="p-10 text-center">
                  <p className="text-sm font-medium">No projects yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Create a Project to provision its Repository, Workspace, and
                    OpenCode session.
                  </p>
                  <Button
                    nativeButton={false}
                    className="mt-4"
                    render={<Link to="/organizations" />}
                  >
                    Create your first project
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {message ? (
        <div className="fixed right-5 bottom-5 max-w-md rounded-lg border bg-background px-4 py-3 text-sm shadow-lg">
          {message}
        </div>
      ) : null}
    </main>
  )
}

function Field({
  label,
  name,
  ...props
}: {
  label: string
  name: string
} & ComponentProps<typeof Input>) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} required {...props} />
    </div>
  )
}
