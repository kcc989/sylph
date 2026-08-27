import { createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Check, Code2, LoaderCircle, Mail } from "lucide-react"
import { useState } from "react"

import { authClient } from "@/lib/auth-client"
import { getDashboard } from "@/lib/workspaces"

export const Route = createFileRoute("/invite/$invitationId")({
  loader: () => getDashboard(),
  component: InvitationScreen,
})

function InvitationScreen() {
  const { invitationId } = Route.useParams()
  const dashboard = Route.useLoaderData()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const acceptInvitation = async () => {
    setPending(true)
    setError(null)
    const result = await authClient.organization.acceptInvitation({
      invitationId,
    })

    if (result.error) {
      setError(
        result.error.message ??
          "Sign in with the exact email address that received this invitation"
      )
      setPending(false)
      return
    }

    window.location.assign("/")
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background px-5 text-foreground">
      <section className="w-full max-w-md border-y py-8">
        <div className="grid size-9 place-items-center rounded-[7px] bg-primary text-primary-foreground">
          <Mail className="size-4" />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-[-0.03em]">
          Join this Sylph Installation
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {dashboard.user
            ? `You are signed in as ${dashboard.user.email}. The invitation must match this address.`
            : "Sign in with the invited email address, then return to this private link."}
        </p>
        {dashboard.user ? (
          <Button
            className="mt-6"
            onClick={acceptInvitation}
            disabled={pending}
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <Check />}
            Accept invitation
          </Button>
        ) : dashboard.authentication.github ? (
          <Button
            className="mt-6"
            onClick={() =>
              authClient.signIn.social({
                provider: "github",
                callbackURL: `/invite/${encodeURIComponent(invitationId)}`,
              })
            }
          >
            <Code2 /> Continue with GitHub
          </Button>
        ) : (
          <p className="mt-6 text-sm text-destructive">
            This Installation does not have an authentication method configured.
          </p>
        )}
        {error ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  )
}
