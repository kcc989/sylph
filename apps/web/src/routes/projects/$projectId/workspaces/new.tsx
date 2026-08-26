import {
  createFileRoute,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  FolderGit2,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { type FormEvent, useState } from "react"

import {
  createWorkspace,
  getWorkspaceCreationContext,
  saveOpenCodeSetup,
} from "@/lib/workspaces"

export const Route = createFileRoute("/projects/$projectId/workspaces/new")({
  loader: ({ params }) =>
    getWorkspaceCreationContext({ data: { projectId: params.projectId } }),
  component: NewWorkspaceScreen,
})

function NewWorkspaceScreen() {
  const { projectId } = Route.useParams()
  const context = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const create = useServerFn(createWorkspace)
  const saveSetup = useServerFn(saveOpenCodeSetup)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setupStep, setSetupStep] = useState<"intro" | "key" | "model">("intro")
  const [apiKey, setApiKey] = useState("")
  const [modelId, setModelId] = useState("nemotron-3.5-lightning-free")
  const [editingSetup, setEditingSetup] = useState(false)

  if (!context) {
    return (
      <main className="dark grid min-h-svh place-items-center bg-[var(--sylph-ink)] px-5 text-foreground">
        <div className="max-w-sm text-center">
          <FolderGit2 className="mx-auto size-7 text-muted-foreground" />
          <h1 className="mt-4 text-lg font-semibold">Project unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This Project does not exist or you cannot create a Workspace in it.
          </p>
          <Button
            nativeButton={false}
            className="mt-5"
            render={<Link to="/" />}
          >
            Return to Projects
          </Button>
        </div>
      </main>
    )
  }

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
        data: {
          organizationId: context.project.organizationId,
          providerId: "opencode",
          modelId,
          apiKey,
        },
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

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const form = new FormData(event.currentTarget)

    try {
      const result = await create({
        data: { projectId, title: String(form.get("title")) },
      })
      await navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: result.id },
      })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The Workspace could not be created"
      )
      setPending(false)
    }
  }

  const needsSetup = !context.setup.providerId || editingSetup

  return (
    <main className="dark min-h-svh bg-[var(--sylph-ink)] text-foreground">
      <header className="flex h-12 items-center border-b px-4 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Projects
        </Link>
        <span className="mx-2 text-muted-foreground/40">/</span>
        <span className="truncate text-xs font-medium">
          {context.project.name}
        </span>
      </header>

      <div className="mx-auto grid min-h-[calc(100svh-3rem)] max-w-5xl lg:grid-cols-[0.72fr_1.28fr]">
        <aside className="border-b px-6 py-8 lg:border-r lg:border-b-0 lg:px-8 lg:py-12">
          <div className="flex items-center gap-2.5">
            <FolderGit2 className="size-4 text-[#ef9b7e]" />
            <h1 className="text-sm font-semibold">{context.project.name}</h1>
          </div>
          <p className="mt-3 pl-6 font-mono text-[10px] text-muted-foreground">
            Repository · {context.project.repositoryName}
          </p>
          <p className="mt-1 pl-6 font-mono text-[10px] text-muted-foreground">
            Base branch · {context.project.defaultBranch}
          </p>
          <div className="mt-9 grid gap-4 border-t pt-6 text-xs text-muted-foreground">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--sylph-live)]" />
              <p className="leading-5">
                The Project’s Repository remains canonical. This Workspace gets
                its own durable fork.
              </p>
            </div>
            <div className="flex gap-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-[var(--sylph-coral)]" />
              <p className="leading-5">
                OpenCode starts in a new session with the selected model and
                isolated working files.
              </p>
            </div>
          </div>
        </aside>

        <section className="flex items-start justify-center px-6 py-8 lg:px-12 lg:py-12">
          <div className="w-full max-w-lg">
            {needsSetup ? (
              <OpenCodeSetup
                apiKey={apiKey}
                error={error}
                modelId={modelId}
                pending={pending}
                setupStep={setupStep}
                onApiKeyChange={setApiKey}
                onBack={() =>
                  setSetupStep(setupStep === "model" ? "key" : "intro")
                }
                onModelChange={setModelId}
                onStart={() => setSetupStep("key")}
                onSubmit={handleSetup}
              />
            ) : (
              <>
                <h2 className="text-2xl font-semibold tracking-[-0.03em]">
                  Start a new Workspace
                </h2>
                <p className="mt-2 max-w-[58ch] text-sm leading-6 text-muted-foreground">
                  Name the work you are starting. Sylph will fork the contained
                  Repository and open a durable OpenCode session.
                </p>
                <form className="mt-8 grid gap-6" onSubmit={handleCreate}>
                  <div className="flex items-center justify-between border-y py-3">
                    <div>
                      <p className="text-xs font-medium">OpenCode configured</p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {context.setup.providerId}/{context.setup.modelId}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSetupStep("intro")
                        setEditingSetup(true)
                      }}
                    >
                      Change
                    </Button>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="title">Workspace name</Label>
                    <Input
                      id="title"
                      name="title"
                      placeholder="Add billing"
                      autoFocus
                      required
                    />
                    <p className="text-xs leading-5 text-muted-foreground">
                      Use the feature, fix, or experiment this Workspace will
                      contain.
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
                      <Plus />
                    )}
                    {pending ? "Starting Workspace…" : "Start Workspace"}
                  </Button>
                </form>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function OpenCodeSetup({
  apiKey,
  error,
  modelId,
  pending,
  setupStep,
  onApiKeyChange,
  onBack,
  onModelChange,
  onStart,
  onSubmit,
}: {
  apiKey: string
  error: string | null
  modelId: string
  pending: boolean
  setupStep: "intro" | "key" | "model"
  onApiKeyChange: (value: string) => void
  onBack: () => void
  onModelChange: (value: string) => void
  onStart: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
}) {
  return (
    <div>
      <div className="grid size-9 place-items-center rounded-[7px] bg-[#ef9b7e]/12 text-[#f2a68d]">
        <KeyRound className="size-4" />
      </div>
      <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em]">
        {setupStep === "intro"
          ? "Connect OpenCode"
          : setupStep === "key"
            ? "Add your Zen key"
            : "Choose the starting model"}
      </h2>
      <p className="mt-2 max-w-[58ch] text-sm leading-6 text-muted-foreground">
        {setupStep === "intro"
          ? "OpenCode needs a model provider before this Workspace can start coding. This connection belongs to the Organization and is reused by all of its Projects."
          : setupStep === "key"
            ? "Sylph encrypts this credential before storing it and never returns it to the browser."
            : "This model becomes the Organization default for each new OpenCode session. You can change it later."}
      </p>
      {setupStep === "intro" ? (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
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
            Get a Zen key <ExternalLink />
          </Button>
          <Button onClick={onStart}>
            I have a key <ArrowRight />
          </Button>
        </div>
      ) : (
        <form className="mt-8 grid gap-5" onSubmit={onSubmit}>
          {setupStep === "key" ? (
            <div className="grid gap-2">
              <Label htmlFor="api-key">API key</Label>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
                autoComplete="off"
                placeholder="opk_…"
                autoFocus
                required
              />
            </div>
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="model-id">OpenCode model</Label>
              <div className="flex rounded-[8px] border bg-sidebar/45 px-3 focus-within:ring-2 focus-within:ring-ring/50">
                <span className="self-center font-mono text-xs text-muted-foreground">
                  opencode/
                </span>
                <Input
                  id="model-id"
                  value={modelId}
                  onChange={(event) => onModelChange(event.target.value)}
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
            <Button type="button" variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : null}
              {setupStep === "model" ? "Connect" : "Continue"}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
