import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router"
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
  ArrowLeft,
  ArrowRight,
  Boxes,
  ExternalLink,
  KeyRound,
  LoaderCircle,
} from "lucide-react"
import { type FormEvent, useState } from "react"

import {
  createProject,
  getOpenCodeSetup,
  saveOpenCodeSetup,
} from "@/lib/workspaces"

export const Route = createFileRoute(
  "/organizations/$organizationId/projects/new"
)({
  loader: ({ params }) =>
    getOpenCodeSetup({ data: { organizationId: params.organizationId } }),
  component: NewProjectScreen,
})

function NewProjectScreen() {
  const { organizationId } = Route.useParams()
  const navigate = useNavigate()
  const router = useRouter()
  const setup = Route.useLoaderData()
  const create = useServerFn(createProject)
  const saveSetup = useServerFn(saveOpenCodeSetup)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setupStep, setSetupStep] = useState<"intro" | "key" | "model">("intro")
  const [apiKey, setApiKey] = useState("")
  const [modelId, setModelId] = useState("nemotron-3.5-lightning-free")
  const [editingSetup, setEditingSetup] = useState(false)

  const handleSetup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (setupStep === "key") {
      setSetupStep("model")
      return
    }

    setPending(true)
    setError(null)

    try {
      await saveSetup({
        data: { organizationId, providerId: "opencode", modelId, apiKey },
      })
      setEditingSetup(false)
      await router.invalidate()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "OpenCode could not connect"
      )
    } finally {
      setPending(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const form = new FormData(event.currentTarget)

    try {
      const result = await create({
        data: {
          organizationId,
          name: String(form.get("name")),
        },
      })
      await navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: result.id },
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The project could not be created"
      )
      setPending(false)
    }
  }

  const needsSetup = !setup?.providerId || editingSetup

  return (
    <main className="grid min-h-svh place-items-center bg-muted/30 px-5 py-10">
      <div className="w-full max-w-lg">
        <Link
          to="/organizations"
          className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Organizations
        </Link>
        {needsSetup ? (
          <Card>
            <CardHeader>
              <div className="mb-2 grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
                <KeyRound className="size-4" />
              </div>
              <CardTitle>Connect OpenCode</CardTitle>
              <CardDescription>
                {setupStep === "intro"
                  ? "Sylph needs a model provider before it can code. OpenCode Zen is the simplest path to a working agent."
                  : setupStep === "key"
                    ? "Paste your OpenCode Zen API key. Sylph encrypts it before storing it and never returns it to the browser."
                    : "Choose the OpenCode model this Organization should use."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {setupStep === "intro" ? (
                <div className="grid gap-4">
                  <Button
                    nativeButton={false}
                    variant="outline"
                    render={
                      <a
                        href="https://opencode.ai/auth"
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                  >
                    Get an OpenCode Zen key <ExternalLink />
                  </Button>
                  <Button onClick={() => setSetupStep("key")}>
                    I have a key <ArrowRight />
                  </Button>
                </div>
              ) : (
                <form className="grid gap-5" onSubmit={handleSetup}>
                  {setupStep === "key" ? (
                    <div className="grid gap-2">
                      <Label htmlFor="api-key">API key</Label>
                      <Input
                        id="api-key"
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        autoComplete="off"
                        placeholder="opk_…"
                        autoFocus
                        required
                      />
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      <Label htmlFor="model-id">Model ID</Label>
                      <div className="flex rounded-md border bg-muted/30 px-3 shadow-xs focus-within:ring-2 focus-within:ring-ring/50">
                        <span className="self-center text-sm text-muted-foreground">
                          opencode/
                        </span>
                        <Input
                          id="model-id"
                          value={modelId}
                          onChange={(event) => setModelId(event.target.value)}
                          className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                          autoFocus
                          required
                        />
                      </div>
                    </div>
                  )}
                  {error ? (
                    <p role="alert" className="text-sm text-destructive">
                      {error}
                    </p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setSetupStep(setupStep === "model" ? "key" : "intro")
                      }
                    >
                      Back
                    </Button>
                    <Button type="submit" disabled={pending}>
                      {pending ? (
                        <LoaderCircle className="animate-spin" />
                      ) : null}
                      {setupStep === "model" ? "Connect" : "Continue"}
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <div className="mb-2 grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Boxes className="size-4" />
              </div>
              <CardTitle>Create a project</CardTitle>
              <CardDescription>
                Sylph creates its Repository, durable Workspace, starter files,
                and first OpenCode v2 session in one step.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-5" onSubmit={handleSubmit}>
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">OpenCode configured</p>
                    <p className="text-xs text-muted-foreground">
                      {setup.providerId}/{setup.modelId}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSetupStep("intro")
                      setEditingSetup(true)
                    }}
                  >
                    Change
                  </Button>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="name">Project name</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="Weather desk"
                    autoFocus
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    The contained Repository and initial Workspace use this
                    name.
                  </p>
                </div>
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
                <Button type="submit" disabled={pending}>
                  {pending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Boxes />
                  )}
                  {pending ? "Starting OpenCode…" : "Create project"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
