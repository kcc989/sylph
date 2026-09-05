import { useState } from "react"
import { useServerFn } from "@tanstack/react-start"
import { useRouter } from "@tanstack/react-router"
import {
  failureMessage,
  instanceModelEnabled,
  instanceModelKey,
  type InstanceModelPolicy,
} from "@workspace/domain"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  ModelCombobox,
  type ModelComboboxOption,
} from "@workspace/ui/components/model-combobox"
import { saveInstanceModels } from "@/functions/instance-models"

export function InstanceModelSettings({
  policy,
  catalog,
}: {
  policy: InstanceModelPolicy
  catalog: ReadonlyArray<ModelComboboxOption>
}) {
  const save = useServerFn(saveInstanceModels)
  const router = useRouter()
  const [draft, setDraft] = useState(policy)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const allModels = [...catalog]
  for (const model of draft.models) {
    if (
      !allModels.some(
        (candidate) => instanceModelKey(candidate) === instanceModelKey(model)
      )
    )
      allModels.push({
        ...model,
        name: model.modelId,
        providerName: model.providerId,
      })
  }
  const visible = allModels.filter((model) =>
    `${model.providerName} ${model.name} ${model.modelId}`
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  )
  const enabled = allModels.filter((model) =>
    instanceModelEnabled(draft, model)
  )
  const groups = [...new Set(visible.map((model) => model.providerName))]

  return (
    <section
      className="border-b py-6"
      aria-labelledby="instance-models-heading"
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="instance-models-heading" className="text-sm font-semibold">
            Models
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {policy.models.length} enabled for this Sylph instance
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          aria-expanded={open}
          aria-controls="instance-model-configuration"
          onClick={() => {
            setDraft(policy)
            setError(null)
            setQuery("")
            setOpen(!open)
          }}
        >
          Configure models
        </Button>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Workspace pickers show enabled models from each user’s connected
        providers. New models stay disabled until you enable them.
      </p>
      {open ? (
        <form
          id="instance-model-configuration"
          className="mt-4 grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault()
            setPending(true)
            setError(null)
            try {
              await save({ data: draft })
              await router.invalidate()
              setOpen(false)
            } catch (cause) {
              setError(failureMessage(cause, "Could not save available models"))
            } finally {
              setPending(false)
            }
          }}
        >
          <Input
            aria-label="Search available models"
            placeholder="Search models or providers"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <fieldset
            disabled={pending}
            className="max-h-72 overflow-y-auto rounded-md border p-3"
          >
            <legend className="sr-only">Enabled models</legend>
            {groups.map((provider) => (
              <div key={provider} className="mb-4 last:mb-0">
                <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                  {provider}
                </h3>
                {visible
                  .filter((model) => model.providerName === provider)
                  .map((model) => (
                    <label
                      key={instanceModelKey(model)}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-primary"
                        checked={instanceModelEnabled(draft, model)}
                        onChange={(event) => {
                          const identity = {
                            providerId: model.providerId,
                            modelId: model.modelId,
                          }
                          const models = event.target.checked
                            ? [...draft.models, identity]
                            : draft.models.filter(
                                (candidate) =>
                                  instanceModelKey(candidate) !==
                                  instanceModelKey(model)
                              )
                          const previousDefault = draft.defaultModel
                          setDraft({
                            models,
                            defaultModel:
                              previousDefault &&
                              models.some(
                                (candidate) =>
                                  instanceModelKey(candidate) ===
                                  instanceModelKey(previousDefault)
                              )
                                ? previousDefault
                                : (models[0] ?? null),
                          })
                        }}
                      />
                      <span className="min-w-0 break-words">{model.name}</span>
                    </label>
                  ))}
              </div>
            ))}
            {!visible.length ? (
              <p className="py-3 text-sm text-muted-foreground">
                {catalog.length
                  ? "No matching models."
                  : "Connect a provider to choose models."}
              </p>
            ) : null}
          </fieldset>
          <div className="grid gap-2">
            <label
              htmlFor="instance-default-model"
              className="text-xs font-medium"
            >
              Instance default model
            </label>
            <ModelCombobox
              id="instance-default-model"
              ariaLabel="Instance default model"
              models={enabled}
              value={draft.defaultModel}
              disabled={pending || !enabled.length}
              onValueChange={(model) =>
                setDraft({ ...draft, defaultModel: model })
              }
            />
          </div>
          {!draft.models.length ? (
            <p className="text-xs text-muted-foreground">
              With no enabled models, users cannot start new agent turns.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save models"}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
