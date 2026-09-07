import {
  InstallationSetupErrorResponse,
  type InstallationSetupStatus,
} from "@workspace/domain"
import { Schema } from "effect"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Code2, LoaderCircle } from "lucide-react"
import { useState, type FormEvent } from "react"
import { authClient } from "@/lib/auth-client"

export function InstallationStart({
  setup,
}: {
  setup: typeof InstallationSetupStatus.Type
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const submit = async (event: FormEvent<HTMLFormElement>, action: string) => {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      const response = await fetch(`/api/setup/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(new FormData(event.currentTarget))
        ),
      })
      if (!response.ok) {
        const failure = Schema.decodeUnknownSync(
          InstallationSetupErrorResponse
        )(await response.json())
        throw new Error(failure.message)
      }
      window.location.reload()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Setup could not finish. Try again."
      )
      setPending(false)
    }
  }
  const signIn = async () => {
    setPending(true)
    setError("")
    try {
      const result = await authClient.signIn.social({
        provider: "github",
        callbackURL: "/setup",
      })
      if (result.error)
        throw new Error(result.error.message ?? "GitHub sign-in failed")
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "GitHub sign-in failed. Try again."
      )
      setPending(false)
    }
  }
  const existingApp = (
    <details className="border-t pt-5">
      <summary className="cursor-pointer text-sm font-medium">
        Connect an existing GitHub App
      </summary>
      <form
        className="mt-5 grid gap-4"
        onSubmit={(event) => submit(event, "github-existing")}
      >
        <p className="text-sm leading-6 text-muted-foreground">
          Set the App's callback URL to:
        </p>
        <code className="text-xs break-all">
          {setup.origin}/api/auth/callback/github
        </code>
        <p className="text-xs leading-5 text-muted-foreground">
          The App needs Contents and Pull requests write access, and Email
          addresses read access. Enable user authorization during installation.
        </p>
        <div className="grid gap-2">
          <Label htmlFor="github-client-id">Client ID</Label>
          <Input
            id="github-client-id"
            name="clientId"
            required
            autoComplete="off"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="github-client-secret">Client secret</Label>
          <Input
            id="github-client-secret"
            name="clientSecret"
            type="password"
            required
            autoComplete="off"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="github-app-url">App URL</Label>
          <Input
            id="github-app-url"
            name="appUrl"
            type="url"
            placeholder="https://github.com/apps/my-sylph"
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          Save GitHub connection
        </Button>
      </form>
    </details>
  )
  return (
    <main className="grid min-h-svh place-items-center bg-background px-5 py-12 text-foreground">
      <section
        className="w-full max-w-md space-y-6"
        aria-labelledby="installation-title"
      >
        <div>
          <h1 id="installation-title" className="text-xl font-semibold">
            {setup.claimed ? "Sign in to Sylph" : "Set up your Sylph"}
          </h1>
          <p className="mt-2 text-sm break-all text-muted-foreground">
            {setup.origin}
          </p>
        </div>
        {!setup.claimed && !setup.unlocked ? (
          <form
            className="grid gap-4"
            onSubmit={(event) => submit(event, "unlock")}
          >
            <p className="text-sm leading-6 text-muted-foreground">
              Your deployment is ready. Enter your setup code to connect GitHub
              and become the first Admin.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="setup-code">Setup code</Label>
              <Input
                id="setup-code"
                name="code"
                type="password"
                required
                minLength={32}
                maxLength={256}
                autoComplete="off"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Use the code you saved as INSTALLATION_CLAIM_SECRET before
                deploying.
              </p>
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : null}Unlock
              setup
            </Button>
          </form>
        ) : !setup.githubConnected ? (
          <div className="space-y-6">
            <form
              action="/api/setup/github"
              method="post"
              className="grid gap-4"
            >
              <p className="text-sm leading-6 text-muted-foreground">
                Create a GitHub App for sign-in and repository access. GitHub
                will ask you to confirm its name and permissions.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="app-name">GitHub App name</Label>
                <Input
                  id="app-name"
                  name="name"
                  defaultValue="My Sylph"
                  required
                  maxLength={34}
                />
                <p className="text-xs text-muted-foreground">
                  Choose a name that is unique on GitHub.
                </p>
              </div>
              <details>
                <summary className="cursor-pointer text-sm">
                  Create under a GitHub organization
                </summary>
                <div className="mt-3 grid gap-2">
                  <Label htmlFor="app-owner">Organization username</Label>
                  <Input
                    id="app-owner"
                    name="owner"
                    placeholder="your-organization"
                    maxLength={100}
                  />
                </div>
              </details>
              <Button type="submit">
                <Code2 />
                Create GitHub App
              </Button>
            </form>
            {existingApp}
          </div>
        ) : (
          <div className="space-y-5">
            <p className="text-sm leading-6 text-muted-foreground">
              {setup.claimed
                ? "Continue with your GitHub account."
                : "GitHub is connected. Install the App on the repositories you want to use, then sign in to finish setup."}
            </p>
            {setup.appUrl ? (
              <a
                className="block text-sm underline underline-offset-4"
                href={`${setup.appUrl}/installations/new`}
                target="_blank"
                rel="noreferrer"
              >
                Install GitHub App
              </a>
            ) : null}
            <Button onClick={signIn} disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : <Code2 />}
              Continue with GitHub
            </Button>
            {!setup.claimed && setup.unlocked ? existingApp : null}
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {!setup.claimed ? (
          <p className="border-t pt-5 text-xs leading-5 text-muted-foreground">
            You can return to this page to finish setup. Saved connections are
            kept.
          </p>
        ) : null}
      </section>
    </main>
  )
}
