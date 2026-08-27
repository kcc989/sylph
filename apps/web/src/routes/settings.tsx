import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Button } from "@workspace/ui/components/button"
import {
  decodeModelOption,
  encodeModelOption,
} from "@workspace/ui/lib/model-option"
import { ArrowRight, ShieldCheck } from "lucide-react"
import { useState } from "react"

import { AppShell } from "@/components/app-shell"
import {
  getDashboard,
  getOpenCodeSetup,
  setDefaultModel,
} from "@/lib/workspaces"

export const Route = createFileRoute("/settings")({
  loader: async () => {
    const dashboard = await getDashboard()
    const organization = dashboard.organizations[0] ?? null
    const setup = organization
      ? await getOpenCodeSetup({ data: { organizationId: organization.id } })
      : null
    return { dashboard, organization, setup }
  },
  component: UserSettingsScreen,
})

function UserSettingsScreen() {
  const { dashboard, organization, setup } = Route.useLoaderData()
  const saveDefault = useServerFn(setDefaultModel)
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = setup?.personalDefault
    ? encodeModelOption(setup.personalDefault)
    : setup?.providerId && setup.modelId
      ? encodeModelOption({
          providerId: setup.providerId,
          modelId: setup.modelId,
        })
      : ""

  return (
    <AppShell active="settings" dashboard={dashboard} topbar="User settings">
      <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
        <section className="border-b pb-6">
          <h1 className="text-xl font-semibold tracking-[-0.03em]">
            User settings
          </h1>
          {dashboard.user ? (
            <p className="mt-1.5 text-sm text-muted-foreground">
              {dashboard.user.email}
            </p>
          ) : null}
        </section>
        <section className="border-b py-6">
          <h2 className="text-sm font-semibold">Default model</h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
            New conversations start with this model. You can choose another
            model for an individual conversation from its composer.
          </p>
          {setup?.models.length ? (
            <div className="mt-4 grid max-w-xl gap-2">
              <label className="text-xs font-medium" htmlFor="default-model">
                Personal default
              </label>
              <select
                id="default-model"
                className="h-10 w-full rounded-[8px] border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                disabled={pending}
                value={selected}
                onChange={async (event) => {
                  if (!organization) return
                  const model = decodeModelOption(event.target.value)
                  if (!model) return
                  setPending(true)
                  setError(null)
                  try {
                    await saveDefault({
                      data: {
                        organizationId: organization.id,
                        scope: "user",
                        providerId: model.providerId,
                        modelId: model.modelId,
                      },
                    })
                    await router.invalidate()
                  } catch (cause) {
                    setError(
                      cause instanceof Error
                        ? cause.message
                        : "Could not save the default model"
                    )
                  } finally {
                    setPending(false)
                  }
                }}
              >
                {setup.models.map((model) => (
                  <option
                    key={`${model.providerId}/${model.modelId}/${model.scope}`}
                    value={encodeModelOption(model)}
                  >
                    {model.providerName} · {model.name} ·{" "}
                    {model.scope === "personal" ? "Personal" : "Organization"}
                  </option>
                ))}
              </select>
              {setup.modelNotice ? (
                <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
                  {setup.modelNotice}
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 flex items-center justify-between gap-4 border-y py-4">
              <p className="text-xs text-muted-foreground">
                Connect an AI provider before choosing a default model.
              </p>
              {dashboard.installation.canAdminister ? (
                <Button
                  nativeButton={false}
                  size="sm"
                  variant="outline"
                  render={<Link to="/admin" />}
                >
                  Connect provider
                </Button>
              ) : null}
            </div>
          )}
        </section>
        <section className="py-6">
          <h2 className="text-sm font-semibold">Installation access</h2>
          <div className="mt-3 flex items-center gap-4 border-y py-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {dashboard.organizations[0]?.name ?? "No access"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {dashboard.installation.role
                  ? `Role: ${dashboard.installation.canAdminister ? "Admin" : "User"}`
                  : "An Admin must invite this account."}
              </p>
            </div>
            {dashboard.installation.canAdminister ? (
              <Button
                nativeButton={false}
                size="sm"
                variant="ghost"
                render={<Link to="/admin" />}
              >
                <ShieldCheck /> Administration <ArrowRight />
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </AppShell>
  )
}
