import { CircleHelp, LoaderCircle } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import type { WorkspaceQuestion, WorkspaceQuestionValue } from "../types"

export function AgentQuestion({
  question,
  pending,
  onAnswer,
}: {
  question: WorkspaceQuestion
  pending: boolean
  onAnswer?: (
    questionId: string,
    answer: Record<string, WorkspaceQuestionValue>
  ) => Promise<void>
}) {
  if (question.status !== "pending") {
    return (
      <article className="min-w-0 border border-white/[.1] bg-white/[.025] px-3.5 py-3">
        <div className="flex items-center gap-2">
          <CircleHelp className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="min-w-0 flex-1 text-[13px] font-medium">
            {question.title}
          </h3>
          <span className="text-[10px] text-muted-foreground">
            {question.status === "answered" ? "Answered" : "Cancelled"}
          </span>
        </div>
        {question.answer ? (
          <dl className="mt-3 grid gap-2 border-t border-white/[.07] pt-3">
            {Object.entries(question.answer).map(([key, value]) => (
              <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr]" key={key}>
                <dt className="text-[10px] text-muted-foreground">{key}</dt>
                <dd className="min-w-0 text-[12px] break-words text-foreground/80">
                  {Array.isArray(value) ? value.join(", ") : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </article>
    )
  }

  return (
    <form
      className="min-w-0 border border-[#ef9b7e]/30 bg-[#ef9b7e]/[.055] px-3.5 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const answer: Record<string, WorkspaceQuestionValue> = {}
        for (const field of question.fields) {
          if (field.type === "external") continue
          if (field.type === "multiselect") {
            answer[field.key] = form.getAll(field.key).map(String)
            continue
          }
          if (field.type === "boolean") {
            answer[field.key] = form.get(field.key) === "true"
            continue
          }
          const value = String(form.get(field.key) ?? "")
          answer[field.key] =
            field.type === "number" || field.type === "integer"
              ? Number(value)
              : value
        }
        void onAnswer?.(question.id, answer)
      }}
    >
      <div className="flex items-start gap-3">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-[#ef9b7e]" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium">{question.title}</h3>
          <div className="mt-3 grid gap-3">
            {question.fields.map((field) => (
              <fieldset className="min-w-0" key={field.key}>
                <label
                  className="block text-[11px] font-medium text-foreground/85"
                  htmlFor={`${question.id}-${field.key}`}
                >
                  {field.title ?? field.key}
                  {field.required ? (
                    <span className="text-[#ef9b7e]"> *</span>
                  ) : null}
                </label>
                {field.description ? (
                  <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                    {field.description}
                  </p>
                ) : null}
                {field.type === "external" ? (
                  <a
                    className="mt-1.5 inline-flex min-h-8 items-center text-[11px] font-medium text-[#ef9b7e] underline decoration-[#ef9b7e]/40 underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href={field.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open required context
                  </a>
                ) : field.type === "boolean" ? (
                  <input
                    className="mt-2 size-4 accent-[#ef9b7e]"
                    defaultChecked={field.defaultValue === true}
                    id={`${question.id}-${field.key}`}
                    name={field.key}
                    type="checkbox"
                    value="true"
                  />
                ) : field.type === "multiselect" ? (
                  <div className="mt-1.5 grid gap-1.5">
                    {field.options.map((option) => (
                      <label
                        className="flex min-w-0 items-start gap-2 text-[11px] text-foreground/80"
                        key={option.value}
                      >
                        <input
                          className="mt-0.5 size-4 shrink-0 accent-[#ef9b7e]"
                          defaultChecked={
                            Array.isArray(field.defaultValue) &&
                            field.defaultValue.includes(option.value)
                          }
                          name={field.key}
                          type="checkbox"
                          value={option.value}
                        />
                        <span className="min-w-0">
                          {option.label}
                          {option.description ? (
                            <span className="block text-[10px] text-muted-foreground">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : field.options.length ? (
                  <select
                    className="mt-1.5 h-9 w-full rounded-[5px] border border-white/[.12] bg-[#171614] px-2 text-base text-foreground outline-none focus:border-[#ef9b7e]/60 focus:ring-2 focus:ring-[#ef9b7e]/20 sm:text-xs"
                    defaultValue={String(field.defaultValue ?? "")}
                    id={`${question.id}-${field.key}`}
                    name={field.key}
                    required={field.required}
                  >
                    <option disabled value="">
                      Select an answer
                    </option>
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="mt-1.5 h-9 w-full rounded-[5px] border border-white/[.12] bg-black/20 px-2 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-[#ef9b7e]/60 focus:ring-2 focus:ring-[#ef9b7e]/20 sm:text-xs"
                    defaultValue={String(field.defaultValue ?? "")}
                    id={`${question.id}-${field.key}`}
                    name={field.key}
                    placeholder={field.placeholder}
                    required={field.required}
                    step={field.type === "integer" ? 1 : undefined}
                    type={
                      field.type === "number" || field.type === "integer"
                        ? "number"
                        : "text"
                    }
                  />
                )}
              </fieldset>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button disabled={pending} size="sm" type="submit">
              {pending ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : null}
              Answer agent
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}
