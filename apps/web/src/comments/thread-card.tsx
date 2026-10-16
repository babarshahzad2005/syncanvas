import { COMMENT_MAX, type CommentView, type ThreadView } from "@syncanvas/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, Send } from "lucide-react"
import { Fragment, useState } from "react"
import { useBoardUi } from "@/board/store"
import { initials } from "@/components/account-menu"
import { Button } from "@/components/ui/button"
import { ApiError, api, queryKeys } from "@/lib/api"
import { timeAgo } from "@/lib/time"
import { cn } from "@/lib/utils"
import { presenceColor } from "@/presence/model"
import { useComments } from "./store"
import { upsertThread } from "./use-threads"

// The Thread card (DESIGN.md → Thread card; M4 ticket 01): the comments, then a reply box for
// Commenters and above. For a new Thread it's just the box; the Thread is saved with it.

/** The counter shows from here up to COMMENT_MAX. */
const COUNTER_FROM = 1800

const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g

/** Comment text with its line breaks kept and web links made clickable. */
function Body({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN)
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-2 hover:underline"
          >
            {part}
          </a>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  )
}

function Comment({ comment }: { comment: CommentView }) {
  const name = comment.author?.name ?? "Comment deleted"
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className="type-label flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-white"
        style={comment.author ? { background: presenceColor(comment.author.id) } : undefined}
      >
        {comment.author ? initials(name) : ""}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-1.5">
          <span className="type-body-strong truncate">{name}</span>
          <span className="type-caption shrink-0 text-muted-foreground">
            {timeAgo(comment.createdAt)}
          </span>
        </span>
        {comment.author ? (
          <Body text={comment.body} />
        ) : (
          <p className="text-muted-foreground italic">Comment deleted</p>
        )}
      </div>
    </li>
  )
}

export function ThreadCard({
  boardId,
  thread,
  canWrite,
  online,
  style,
}: {
  boardId: string
  /** Null for a new Thread that isn't saved yet. */
  thread: ThreadView | null
  canWrite: boolean
  online: boolean
  style: React.CSSProperties
}) {
  const queryClient = useQueryClient()
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: async (body: string) => {
      if (thread) return api.reply(boardId, thread.id, { body })
      const anchor = useComments.getState().draft
      if (!anchor) throw new Error("no draft")
      return api.createThread(boardId, { anchor, body })
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<ThreadView[]>(queryKeys.threads(boardId), (old) =>
        upsertThread(old ?? [], saved),
      )
      setText("")
      setError(null)
      if (!thread) {
        useComments.getState().openThread(saved.id)
        useBoardUi.getState().setTool("select")
      }
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Couldn't send it. Check your connection."),
  })

  function submit() {
    const body = text.trim()
    if (body && !send.isPending) send.mutate(body)
  }

  return (
    <section
      data-comment-ui
      aria-label={thread ? "Comment thread" : "New comment"}
      className="absolute z-20 flex max-h-[min(28rem,calc(100%-24px))] w-80 flex-col rounded-xl bg-popover text-popover-foreground shadow-popover"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          useComments.getState().close()
        }
      }}
    >
      {thread && (
        <ul className="flex flex-col gap-3 overflow-y-auto p-3">
          {thread.comments.map((c) => (
            <Comment key={c.id} comment={c} />
          ))}
        </ul>
      )}
      {canWrite && (
        <form
          className={cn("flex flex-col gap-1.5 p-3", thread && "border-t")}
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              aria-label={thread ? "Reply" : "Comment"}
              placeholder={
                !online ? "Comments need a connection" : thread ? "Reply…" : "Add a comment…"
              }
              disabled={!online}
              value={text}
              maxLength={COMMENT_MAX}
              rows={Math.min(6, Math.max(1, text.split("\n").length))}
              // biome-ignore lint/a11y/noAutofocus: a new comment or a reply starts typing here
              autoFocus
              onChange={(e) => {
                setText(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
                // Escape with nothing typed drops a new Thread (DESIGN.md → Comment tool).
                if (e.key === "Escape" && !thread && text.trim() === "") {
                  e.stopPropagation()
                  useComments.getState().close()
                  useBoardUi.getState().setTool("select")
                }
              }}
              className="min-h-9 flex-1 resize-none rounded-lg border border-input bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
            <Button
              type="submit"
              size="icon"
              aria-label={thread ? "Send reply" : "Send comment"}
              disabled={!online || send.isPending || text.trim() === ""}
            >
              {send.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
          {text.length >= COUNTER_FROM && (
            <p className="type-caption text-muted-foreground">
              {text.length.toLocaleString()} / {COMMENT_MAX.toLocaleString()}
            </p>
          )}
          {error && (
            <p role="alert" className="type-caption text-destructive">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  )
}
