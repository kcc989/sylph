"use client"

import { Check, ChevronRight } from "lucide-react"
import { useRef } from "react"

import { ModelCombobox } from "@workspace/ui/components/model-combobox"
import type { ComposerModel } from "./types"

type Selection = { providerId: string; modelId: string; variant?: string }

export function ThinkingModelPicker({
  models,
  selectedModel,
  disabled,
  onModelChange,
}: {
  models: ReadonlyArray<ComposerModel>
  selectedModel: Selection | null
  disabled: boolean
  onModelChange?: (model: Selection) => void
}) {
  const choices = useRef(new Map<string, string | undefined>())
  const selected = models.find(
    (model) =>
      model.providerId === selectedModel?.providerId &&
      model.modelId === selectedModel.modelId
  )
  const options = selected?.thinkingOptions ?? []
  const current = options.find(
    (option) => option.value === selectedModel?.variant
  )
  const toggle =
    options.length > 0 && options.every((option) => option.kind === "toggle")
  const label = toggle ? "Thinking" : "Effort"
  const valueLabel = current?.label ?? "Auto"

  return (
    <div className="mr-auto max-w-full min-w-0 flex-1">
      <ModelCombobox
        ariaLabel="Model and thinking settings"
        disabled={disabled}
        models={models}
        value={selectedModel}
        side="top"
        align="start"
        triggerClassName="h-9 w-fit max-w-full rounded-full border-transparent bg-white/[.06] px-3 text-sm hover:bg-white/[.1]"
        triggerSuffix={
          options.length ? (
            <span className="shrink-0 text-muted-foreground">
              {toggle ? `Thinking ${valueLabel.toLowerCase()}` : valueLabel}
            </span>
          ) : null
        }
        onValueChange={(model) => {
          if (selectedModel)
            choices.current.set(
              `${selectedModel.providerId}/${selectedModel.modelId}`,
              selectedModel.variant
            )
          const variant = choices.current.get(
            `${model.providerId}/${model.modelId}`
          )
          const next = models.find(
            (item) =>
              item.providerId === model.providerId &&
              item.modelId === model.modelId
          )
          onModelChange?.({
            ...model,
            variant: next?.thinkingOptions?.some(
              (option) => option.value === variant
            )
              ? variant
              : undefined,
          })
        }}
        footer={
          options.length ? (
            <details
              key={`${selected?.providerId}/${selected?.modelId}`}
              className="group border-t border-white/10 p-2"
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-2.5 text-sm outline-none hover:bg-white/[.07] focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <span>{label}</span>
                <span className="ml-auto text-muted-foreground">
                  {valueLabel}
                </span>
                <ChevronRight className="size-4 text-muted-foreground group-open:rotate-90" />
              </summary>
              <fieldset
                aria-label={toggle ? "Thinking mode" : "Reasoning level"}
                className="mt-1 border-t border-white/10 pt-2"
              >
                <p className="px-2 pb-2 text-xs leading-relaxed text-muted-foreground">
                  {toggle
                    ? "Turn thinking on or off for this model."
                    : "Higher effort can take more time and tokens."}
                </p>
                {[{ value: "", label: "Automatic" }, ...options].map(
                  (option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-white/[.07] has-focus-visible:ring-2 has-focus-visible:ring-ring"
                    >
                      <input
                        type="radio"
                        name="thinking-level"
                        className="peer sr-only"
                        value={option.value}
                        checked={
                          (selectedModel?.variant ?? "") === option.value
                        }
                        onChange={() =>
                          selectedModel &&
                          onModelChange?.({
                            ...selectedModel,
                            variant: option.value || undefined,
                          })
                        }
                      />
                      <span>{option.label}</span>
                      {option.value === "" ? (
                        <span className="rounded bg-white/[.06] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          Provider default
                        </span>
                      ) : null}
                      <Check className="ml-auto size-4 opacity-0 peer-checked:opacity-100" />
                    </label>
                  )
                )}
              </fieldset>
            </details>
          ) : null
        }
      />
    </div>
  )
}
