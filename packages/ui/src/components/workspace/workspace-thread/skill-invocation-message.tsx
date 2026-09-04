import { Blocks } from "lucide-react"

import type { ThreadEntry } from "../types"

export function SkillInvocationMessage({ entry }: { entry: ThreadEntry }) {
  if (!entry.skill) {
    return (
      <p className="text-[13px] leading-5 whitespace-pre-wrap text-foreground">
        {entry.body}
      </p>
    )
  }

  return (
    <div className="grid justify-items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-label={`Invoked ${entry.skill.name} Skill`}
          className="inline-flex h-6 items-center gap-1.5 rounded-[5px] border border-[#ef9b7e]/30 bg-[#ef9b7e]/10 px-2 text-[#ef9b7e]"
        >
          <Blocks aria-hidden="true" className="size-3.5" />
          <span className="font-mono text-[11px] font-medium">
            /{entry.skill.name}
          </span>
        </span>
        <span className="text-[10px] text-muted-foreground">
          {entry.skill.scope === "project"
            ? "Project skill"
            : "Installation skill"}
        </span>
      </div>
      {entry.skill.prompt && (
        <p className="text-[13px] leading-5 whitespace-pre-wrap text-foreground">
          {entry.skill.prompt}
        </p>
      )}
    </div>
  )
}
