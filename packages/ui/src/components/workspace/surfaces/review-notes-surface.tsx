"use client"

import {
  BadgeCheck,
  Check,
  LoaderCircle,
  MessageCircle,
  RotateCcw,
} from "lucide-react"
import { useState } from "react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  CodeReview,
  type CodeReviewAnnotation,
  type CodeReviewSelection,
} from "@workspace/ui/components/code-review"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import type {
  WorkspaceReview,
  WorkspaceReviewActor,
  WorkspaceReviewComment,
  WorkspaceReviewCommentDraft,
} from "../types"

const reviewerInitials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()

function ReviewerIdentity({
  actor,
  detail,
}: {
  actor: WorkspaceReviewActor
  detail?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar size="sm">
        {actor.image ? <AvatarImage alt="" src={actor.image} /> : null}
        <AvatarFallback>{reviewerInitials(actor.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-foreground">
          {actor.name}
        </p>
        {detail ? (
          <p className="truncate text-[9px] text-muted-foreground">{detail}</p>
        ) : null}
      </div>
    </div>
  )
}

function ReviewCommentCard({
  comment,
  pending,
  onResolve,
}: {
  comment: WorkspaceReviewComment
  pending: boolean
  onResolve?: (commentId: string, resolved: boolean) => Promise<void>
}) {
  const resolved = comment.resolvedAt !== null

  return (
    <article
      className={cn(
        "border border-white/[.09] bg-[#1a1917] text-left font-sans shadow-[0_5px_16px_rgba(0,0,0,.2)]",
        resolved && "opacity-65"
      )}
    >
      <header className="flex items-center gap-2 border-b border-white/[.07] px-2.5 py-2">
        <ReviewerIdentity actor={comment.author} />
        <span className="ml-auto font-mono text-[9px] text-muted-foreground">
          {comment.startLine === comment.endLine
            ? `L${comment.startLine}`
            : `L${comment.startLine}–${comment.endLine}`}
        </span>
      </header>
      <p className="px-2.5 py-2 text-[11px] leading-5 wrap-break-word whitespace-pre-wrap text-foreground/85">
        {comment.body}
      </p>
      <footer className="flex items-center gap-2 border-t border-white/[.06] px-2.5 py-1.5">
        <span
          className={cn(
            "text-[9px]",
            resolved ? "text-[var(--sylph-live)]" : "text-muted-foreground"
          )}
        >
          {resolved
            ? `Resolved${comment.resolvedBy ? ` by ${comment.resolvedBy.name}` : ""}`
            : "Open"}
        </span>
        <Button
          className="ml-auto h-6 px-2 text-[9px]"
          disabled={pending || !onResolve}
          onClick={() => void onResolve?.(comment.id, !resolved)}
          size="xs"
          variant="ghost"
        >
          {resolved ? <RotateCcw /> : <Check />}
          {resolved ? "Reopen" : "Resolve"}
        </Button>
      </footer>
    </article>
  )
}

function ReviewComposer({
  selection,
  pending,
  onCancel,
  onSubmit,
}: {
  selection: CodeReviewSelection
  pending: boolean
  onCancel: () => void
  onSubmit?: (comment: WorkspaceReviewCommentDraft) => Promise<boolean>
}) {
  const [body, setBody] = useState("")
  const side = selection.endSide ?? selection.side ?? "additions"
  const sameSide =
    !selection.side || !selection.endSide || selection.side === side
  const startLine = sameSide
    ? Math.min(selection.start, selection.end)
    : selection.end
  const endLine = sameSide
    ? Math.max(selection.start, selection.end)
    : selection.end

  return (
    <div className="border border-[var(--sylph-coral)]/35 bg-[#1a1917] p-2.5 font-sans shadow-[0_6px_20px_rgba(0,0,0,.28)]">
      <div className="mb-2 flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
        <MessageCircle className="size-3 text-[var(--sylph-coral)]" />
        {selection.file} ·{" "}
        {startLine === endLine ? `L${startLine}` : `L${startLine}–${endLine}`}
      </div>
      <Textarea
        aria-label="Review comment"
        autoFocus
        className="min-h-20 resize-y bg-black/20 text-base md:text-xs"
        disabled={pending}
        maxLength={5_000}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Leave a clear, actionable comment"
        value={body}
      />
      <div className="mt-2 flex justify-end gap-1.5">
        <Button disabled={pending} onClick={onCancel} size="xs" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={pending || !body.trim() || !onSubmit}
          onClick={() =>
            void onSubmit?.({
              file: selection.file,
              side,
              startLine,
              endLine,
              body: body.trim(),
            }).then((saved) => {
              if (saved) onCancel()
            })
          }
          size="xs"
        >
          {pending ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          ) : (
            <MessageCircle />
          )}
          Add comment
        </Button>
      </div>
    </div>
  )
}

export function ReviewNotesSurface({
  patch,
  review,
  currentReviewer,
  pending = false,
  error,
  onAddComment,
  onResolveComment,
  onSubmitReview,
}: {
  patch?: string
  review?: WorkspaceReview
  currentReviewer?: WorkspaceReviewActor
  pending?: boolean
  error?: string | null
  onAddComment?: (comment: WorkspaceReviewCommentDraft) => Promise<boolean>
  onResolveComment?: (commentId: string, resolved: boolean) => Promise<void>
  onSubmitReview?: (decision: "approved" | "changes_requested") => Promise<void>
}) {
  const [selectionState, setSelectionState] = useState<{
    commit: string
    selection: CodeReviewSelection
  } | null>(null)
  const selection =
    review && selectionState?.commit === review.commit
      ? selectionState.selection
      : null

  if (!patch || !review || !currentReviewer) {
    return (
      <section className="grid size-full place-items-center bg-background px-6 text-center">
        <div className="max-w-sm">
          <Check className="mx-auto mb-3 size-5 text-muted-foreground" />
          <h2 className="text-sm font-medium">No checkpoint to review</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Create a Checkpoint to comment on changed lines and submit a review.
          </p>
        </div>
      </section>
    )
  }

  const unresolvedComments = review.comments.filter(
    (comment) => comment.resolvedAt === null
  )
  const annotations: CodeReviewAnnotation[] = review.comments.map(
    (comment) => ({
      id: comment.id,
      file: comment.file,
      side: comment.side,
      lineNumber: comment.endLine,
    })
  )
  if (selection) {
    annotations.push({
      id: "review-composer",
      file: selection.file,
      side: selection.endSide ?? selection.side ?? "additions",
      lineNumber: selection.end,
    })
  }
  const decisionLabel = {
    pending: "Review pending",
    approved: "Approved",
    changes_requested: "Changes requested",
  }[review.decision]

  return (
    <section className="@container flex size-full min-h-0 flex-col bg-background">
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b bg-[#171614] px-3 py-1.5">
        {review.decision === "approved" ? (
          <BadgeCheck className="size-4 text-[var(--sylph-live)]" />
        ) : (
          <MessageCircle className="size-4 text-[var(--sylph-coral)]" />
        )}
        <div className="min-w-0">
          <h2 className="text-xs font-medium">
            Review {review.commit.slice(0, 7)}
          </h2>
          <p className="text-[9px] text-muted-foreground">
            Select changed lines or use + in the gutter to comment.
          </p>
        </div>
        <Badge
          className={cn(
            "ml-auto rounded-[4px] px-1.5 text-[9px]",
            review.decision === "approved" &&
              "border-[var(--sylph-live)]/30 text-[var(--sylph-live)]",
            review.decision === "changes_requested" &&
              "border-[var(--sylph-coral)]/40 text-[var(--sylph-coral)]"
          )}
          variant="outline"
        >
          {decisionLabel}
        </Badge>
      </header>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(13rem,40%)] @2xl:grid-cols-[minmax(0,1fr)_17rem] @2xl:grid-rows-1">
        <CodeReview
          annotations={annotations}
          className="h-full min-h-0 border-b border-white/[.08] @2xl:border-r @2xl:border-b-0"
          onLineSelected={(nextSelection) =>
            setSelectionState(
              nextSelection
                ? { commit: review.commit, selection: nextSelection }
                : null
            )
          }
          patch={patch}
          renderAnnotation={(annotation) => {
            if (annotation.id === "review-composer" && selection) {
              return (
                <ReviewComposer
                  onCancel={() => setSelectionState(null)}
                  onSubmit={onAddComment}
                  pending={pending}
                  selection={selection}
                />
              )
            }
            const comment = review.comments.find(
              (candidate) => candidate.id === annotation.id
            )
            return comment ? (
              <ReviewCommentCard
                comment={comment}
                onResolve={onResolveComment}
                pending={pending}
              />
            ) : null
          }}
          selectedLines={selection}
        />
        <aside className="flex min-h-0 flex-col bg-[#171614]">
          <div className="border-b border-white/[.07] p-3">
            <ReviewerIdentity actor={currentReviewer} detail="Reviewing as" />
            {review.reviewer ? (
              <div className="mt-3 border-t border-white/[.06] pt-3">
                <ReviewerIdentity
                  actor={review.reviewer}
                  detail={`${decisionLabel}${
                    review.submittedAt
                      ? ` · ${new Intl.DateTimeFormat(undefined, {
                          month: "short",
                          day: "numeric",
                        }).format(review.submittedAt)}`
                      : ""
                  }`}
                />
              </div>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className="mb-2 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{review.comments.length} comments</span>
              <span>·</span>
              <span>{unresolvedComments.length} open</span>
            </div>
            {review.comments.length ? (
              <div className="space-y-2">
                {review.comments.map((comment) => (
                  <div
                    className="border-b border-white/[.06] pb-2 text-[10px] last:border-b-0"
                    key={comment.id}
                  >
                    <p className="truncate font-mono text-[9px] text-[var(--sylph-coral)]">
                      {comment.file} · L{comment.startLine}
                    </p>
                    <p
                      className={cn(
                        "mt-1 line-clamp-2 leading-4 text-foreground/75",
                        comment.resolvedAt &&
                          "text-muted-foreground line-through"
                      )}
                    >
                      {comment.body}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] leading-4 text-muted-foreground">
                No comments. Select a changed line when the review needs a note.
              </p>
            )}
          </div>
          <footer className="shrink-0 border-t border-white/[.08] p-3">
            {error ? (
              <p
                className="mb-2 text-[10px] leading-4 text-red-300"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <Button
              className="w-full justify-center"
              disabled={pending || !onSubmitReview}
              onClick={() => void onSubmitReview?.("changes_requested")}
              size="sm"
              variant="outline"
            >
              {pending ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : (
                <MessageCircle />
              )}
              Request changes
            </Button>
            <Button
              className="mt-1.5 w-full justify-center bg-[var(--sylph-live)] text-[#11100f] hover:bg-[var(--sylph-live)]/90"
              disabled={
                pending || unresolvedComments.length > 0 || !onSubmitReview
              }
              onClick={() => void onSubmitReview?.("approved")}
              size="sm"
              title={
                unresolvedComments.length
                  ? "Resolve all comments before approving"
                  : undefined
              }
            >
              {pending ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : (
                <BadgeCheck />
              )}
              Approve
            </Button>
          </footer>
        </aside>
      </div>
    </section>
  )
}
