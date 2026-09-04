"use client"

import { LoaderCircle, ShieldCheck } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import type { WorkspacePermissionRequest } from "../types"

export function PermissionRequest({
  onReply,
  pending,
  request,
}: {
  onReply?: (
    requestId: string,
    reply: "once" | "always" | "reject"
  ) => Promise<void>
  pending: boolean
  request: WorkspacePermissionRequest
}) {
  return (
    <article className="min-w-0 border border-[#ef9b7e]/30 bg-[#ef9b7e]/[.055] px-3.5 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#ef9b7e]" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium text-foreground">
            Permission requested
          </h3>
          <p className="mt-1 text-[12px] leading-5 text-foreground/75">
            {request.message ?? `The assistant wants to run ${request.action}.`}
          </p>
          <p
            className="mt-2 truncate font-mono text-[11px] text-muted-foreground"
            title={request.resources.join(", ")}
          >
            {request.resources.join(", ") || request.action}
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              disabled={pending}
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => onReply?.(request.id, "reject")}
            >
              Reject
            </Button>
            {request.canSave ? (
              <Button
                disabled={pending}
                size="sm"
                type="button"
                variant="outline"
                onClick={() => onReply?.(request.id, "always")}
              >
                Always allow
              </Button>
            ) : null}
            <Button
              disabled={pending}
              size="sm"
              type="button"
              onClick={() => onReply?.(request.id, "once")}
            >
              {pending ? <LoaderCircle className="animate-spin" /> : null}
              Allow once
            </Button>
          </div>
        </div>
      </div>
    </article>
  )
}
