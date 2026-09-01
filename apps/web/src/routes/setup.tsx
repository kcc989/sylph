import { createFileRoute, Link } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { failureMessage } from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ArrowLeft, Code2, LoaderCircle, ShieldCheck } from "lucide-react"
import { type FormEvent, useState } from "react"

import { AppShell } from "@/components/app-shell"
import { authClient } from "@/lib/auth-client"
import { claimInstallation, getDashboard } from "@/functions/installation"

export const Route = createFileRoute("/setup")({
  loader: () => getDashboard(),
  component: InstallationSetupScreen,
})

function InstallationSetupScreen() {
  const dashboard = Route.useLoaderData()
  const claim = useServerFn(claimInstallation)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClaim = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const form = new FormData(event.currentTarget)

    try {
      await claim({
        data: {
          organizationName: String(form.get("organizationName")),
          confirmedEmail: String(form.get("confirmedEmail")),
          claimSecret: String(form.get("claimSecret")),
        },
      })
      window.location.assign("/admin?onboarding=1")
    } catch (cause) {
      setError(failureMessage(cause, "The Installation could not be claimed"))
      setPending(false)
    }
  }

  if (!dashboard.user) {
    return (
      <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Sign in before setup</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your authenticated account becomes the first Admin when you claim
            this Installation.
          </p>
          {dashboard.authentication.github ? (
            <Button
              className="mt-6"
              onClick={() =>
                authClient.signIn.social({
                  provider: "github",
                  callbackURL: "/setup",
                })
              }
            >
              <Code2 /> Continue with GitHub
            </Button>
          ) : (
            <Button
              nativeButton={false}
              className="mt-6"
              render={<Link to="/" />}
            >
              Return to sign in
            </Button>
          )}
        </div>
      </main>
    )
  }

  if (dashboard.installation.claimed) {
    return (
      <AppShell active="home" dashboard={dashboard} topbar="Installation">
        <div className="mx-auto max-w-2xl px-5 py-12 sm:px-8">
          <section className="border-y py-8">
            <h1 className="text-xl font-semibold">Installation claimed</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {dashboard.installation.canAdminister
                ? "Your account is an Admin for this Installation."
                : "Ask an Admin to invite this account before continuing."}
            </p>
            <Button
              nativeButton={false}
              className="mt-6"
              render={
                <Link
                  to={dashboard.installation.canAdminister ? "/admin" : "/"}
                />
              }
            >
              Continue
            </Button>
          </section>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell active="home" dashboard={dashboard} topbar="Installation setup">
      <main className="px-5 py-10">
        <div className="mx-auto w-full max-w-xl">
          <Link
            to="/"
            className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Sign out or change account
          </Link>
          <section className="border-y py-8">
            <div className="flex items-start gap-4">
              <div className="grid size-9 shrink-0 place-items-center rounded-[7px] bg-primary text-primary-foreground">
                <ShieldCheck className="size-4" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-[-0.03em]">
                  Claim this Installation
                </h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  This creates the default Organization and makes your verified
                  account its first Admin.
                </p>
              </div>
            </div>
            <form className="mt-7 grid gap-5" onSubmit={handleClaim}>
              <div className="grid gap-2">
                <Label htmlFor="organization-name">Organization name</Label>
                <Input
                  id="organization-name"
                  name="organizationName"
                  placeholder="Acme Labs"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirmed-email">Confirm Admin email</Label>
                <Input
                  id="confirmed-email"
                  name="confirmedEmail"
                  type="email"
                  autoComplete="email"
                  placeholder={dashboard.user.email}
                  required
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Enter {dashboard.user.email} exactly. GitHub must report this
                  address as verified before the claim can continue.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="claim-secret">Installation claim secret</Label>
                <Input
                  id="claim-secret"
                  name="claimSecret"
                  type="password"
                  autoComplete="off"
                  required
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  The deployment setup wizard generated this one-time secret.
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
                  <ShieldCheck />
                )}
                Claim Installation
              </Button>
            </form>
          </section>
        </div>
      </main>
    </AppShell>
  )
}
