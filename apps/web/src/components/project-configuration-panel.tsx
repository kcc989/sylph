import { useServerFn } from "@tanstack/react-start"
import { useRouter } from "@tanstack/react-router"
import { failureMessage } from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { useState } from "react"
import {
  type getProjectConfiguration,
  setProjectDomain,
  setProjectSecret,
} from "@/functions/project-resources"

type ProjectConfiguration = Awaited<ReturnType<typeof getProjectConfiguration>>

export function ProjectConfigurationPanel({
  configuration,
  projectId,
  canManage,
}: {
  configuration: ProjectConfiguration
  projectId: string
  canManage: boolean
}) {
  const saveSecret = useServerFn(setProjectSecret)
  const saveDomain = useServerFn(setProjectDomain)
  const router = useRouter()
  const [environment, setEnvironment] = useState<"preview" | "production">(
    "preview"
  )
  const [name, setName] = useState("")
  const [value, setValue] = useState("")
  const [hostname, setHostname] = useState(configuration.domain?.hostname ?? "")
  const [zoneId, setZoneId] = useState(configuration.domain?.zone_id ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const change = async (operation: () => Promise<void>) => {
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      await operation()
      await router.invalidate()
      setNotice("Saved. Configuration changes apply on the next deployment.")
    } catch (cause) {
      setError(
        failureMessage(cause, "Project configuration could not be saved")
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <section
      className="border-b py-6"
      aria-labelledby="project-configuration-title"
    >
      <h2 id="project-configuration-title" className="text-sm font-medium">
        Deployment configuration
      </h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Secrets are encrypted. Preview and production use separate values.
        Changes apply on the next deployment.
      </p>
      <h3 className="mt-5 text-sm font-medium">Application secrets</h3>
      {configuration.secrets.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          No application secrets configured.
        </p>
      )}
      <ul className="mt-2 divide-y">
        {configuration.secrets.map((secret) => (
          <li
            key={`${secret.environment}:${secret.name}`}
            className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs"
          >
            <span className="min-w-0 break-all">
              <span className="font-mono">{secret.name}</span> ·{" "}
              {secret.environment}
            </span>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                aria-label={`Remove ${secret.name} from ${secret.environment}`}
                onClick={() =>
                  void change(async () => {
                    if (
                      secret.environment !== "production" &&
                      secret.environment !== "preview"
                    )
                      throw new Error("Unknown secret environment")
                    await saveSecret({
                      data: {
                        projectId,
                        environment: secret.environment,
                        name: secret.name,
                        value: null,
                      },
                    })
                  })
                }
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void change(async () => {
              await saveSecret({
                data: { projectId, environment, name, value },
              })
              setValue("")
              setName("")
            })
          }}
        >
          <label className="grid gap-1 text-xs">
            Environment
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={environment}
              onChange={(event) =>
                setEnvironment(
                  event.target.value === "production" ? "production" : "preview"
                )
              }
              disabled={pending}
            >
              <option value="preview">Preview</option>
              <option value="production">Production</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            Secret name
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="PAYMENTS_API_KEY"
              autoComplete="off"
              required
              disabled={pending}
            />
          </label>
          <label className="grid gap-1 text-xs">
            Secret value
            <Input
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="new-password"
              required
              disabled={pending}
            />
          </label>
          <Button
            className="justify-self-start"
            size="sm"
            type="submit"
            disabled={pending}
          >
            {pending ? "Saving…" : "Save secret"}
          </Button>
        </form>
      )}
      <h3 className="mt-6 text-sm font-medium">Production custom domain</h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Use a domain in your Cloudflare account. The deployment plan must
        include this domain; Alchemy configures it during the approved
        production deployment.
      </p>
      <form
        className="mt-4 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          void change(async () => {
            await saveDomain({ data: { projectId, hostname, zoneId } })
          })
        }}
      >
        <label className="grid gap-1 text-xs">
          Hostname
          <Input
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            placeholder="app.example.com"
            disabled={!canManage || pending}
          />
        </label>
        <label className="grid gap-1 text-xs">
          Cloudflare zone ID
          <Input
            value={zoneId}
            onChange={(event) => setZoneId(event.target.value)}
            disabled={!canManage || pending}
          />
        </label>
        {canManage && (
          <Button
            className="justify-self-start"
            size="sm"
            type="submit"
            disabled={pending}
          >
            Save domain
          </Button>
        )}
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </section>
  )
}
