"use client"

import { Combobox } from "@base-ui/react/combobox"
import { Check, ChevronDown, Search } from "lucide-react"
import { useState } from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

export type ModelComboboxOption = {
  providerId: string
  modelId: string
  name: string
  providerName: string
  scope?: string
}

type ModelComboboxProps = {
  id?: string
  ariaLabel: string
  disabled?: boolean
  models: ReadonlyArray<ModelComboboxOption>
  value?: { providerId: string; modelId: string } | null
  onValueChange?: (model: { providerId: string; modelId: string }) => void
  placeholder?: string
  side?: "top" | "bottom"
  align?: "start" | "center" | "end"
  triggerClassName?: string
}

export function ModelCombobox({
  id,
  ariaLabel,
  disabled = false,
  models,
  value,
  onValueChange,
  placeholder = "Select model",
  side = "bottom",
  align = "start",
  triggerClassName,
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const selectedOption = value
    ? (models.find(
        (model) =>
          model.providerId === value.providerId &&
          model.modelId === value.modelId
      ) ?? null)
    : null

  return (
    <Combobox.Root<ModelComboboxOption>
      autoHighlight
      disabled={disabled}
      filter={(option, inputValue) => {
        const normalized = inputValue.trim().toLocaleLowerCase()
        if (!normalized) return true
        return `${option.name} ${option.providerName}`
          .toLocaleLowerCase()
          .includes(normalized)
      }}
      inputValue={query}
      isItemEqualToValue={(option, selectedValue) =>
        option.providerId === selectedValue.providerId &&
        option.modelId === selectedValue.modelId
      }
      items={models}
      itemToStringLabel={(option) => option.name}
      onInputValueChange={setQuery}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setQuery("")
      }}
      onValueChange={(option) => {
        if (!option) return
        setQuery("")
        onValueChange?.({
          providerId: option.providerId,
          modelId: option.modelId,
        })
      }}
      open={open}
      value={selectedOption}
    >
      <Combobox.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "flex h-10 w-full min-w-0 items-center gap-1.5 rounded-[8px] border bg-background px-3 text-sm text-foreground outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          triggerClassName
        )}
      >
        <Tooltip>
          <TooltipTrigger
            render={<span />}
            className="min-w-0 flex-1 truncate text-left"
          >
            {selectedOption?.name ?? placeholder}
          </TooltipTrigger>
          {selectedOption ? (
            <TooltipContent className="max-w-80" side="top">
              {selectedOption.name}
            </TooltipContent>
          ) : null}
        </Tooltip>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          align={align}
          className="isolate z-50"
          side={side}
          sideOffset={4}
        >
          <Combobox.Popup className="dark w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-[6px] bg-[#1c1a18] text-[#f4efe8] shadow-md ring-1 ring-white/10 outline-none">
            <div className="relative border-b border-white/[.08] p-2">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Combobox.Input
                aria-label="Search models"
                className="h-9 w-full rounded-[5px] border border-white/[.1] bg-black/20 pr-3 pl-9 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-[#ef9b7e]/60 focus:ring-2 focus:ring-[#ef9b7e]/20 sm:text-sm"
                placeholder="Search models…"
              />
            </div>
            <Combobox.Empty className="text-center text-xs text-muted-foreground">
              <span className="block px-3 py-8">No matching models</span>
            </Combobox.Empty>
            <Combobox.List className="max-h-72 overflow-y-auto p-1">
              {(option: ModelComboboxOption, index: number) => (
                <Combobox.Item
                  aria-label={`${option.name}, ${option.providerName}`}
                  className="grid min-w-0 cursor-default grid-cols-[minmax(0,1fr)_5rem_1rem] items-center gap-2 rounded-[4px] px-2 py-1.5 text-xs outline-none data-highlighted:bg-white/[.08]"
                  index={index}
                  key={`${option.providerId}/${option.modelId}/${option.scope ?? ""}`}
                  value={option}
                >
                  <Tooltip>
                    <TooltipTrigger
                      render={<span />}
                      className="min-w-0 truncate text-left text-foreground"
                    >
                      {option.name}
                    </TooltipTrigger>
                    <TooltipContent className="max-w-80" side="left">
                      {option.name}
                    </TooltipContent>
                  </Tooltip>
                  <span className="w-20 truncate text-right text-[10px] text-muted-foreground">
                    {option.providerName}
                  </span>
                  <Combobox.ItemIndicator className="grid size-4 place-items-center">
                    <Check className="size-3.5" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
