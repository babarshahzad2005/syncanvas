import { COMMENT_MAX, type CommentView, type ThreadView } from "@syncanvas/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, Ellipsis, Loader2, RotateCcw, Send } from "lucide-react"
import { Fragment, useState } from "react"
import { toast } from "sonner"
import { useBoardUi } from "@/board/store"
import { initials } from "@/components/account-menu"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ApiError, api, queryKeys } from "@/lib/api"
import { timeAgo } from "@/lib/time"
import { cn } from "@/lib/utils"
import { presenceColor } from "@/presence/model"
import { useComments } from "./store"
import { upsertThread } from "./use-threads"

// The Thread card (DESIGN.md → Thread card; M4 tickets 01–02): the comments, then a reply box
// for Commenters and above. For a new Thread it's just the box; the Thread is saved with it.
// Authors edit and delete their own comments, the Owner deletes any, and Commenters and above
// resolve and reopen. The server checks every one of these; the card only offers them.

/** The counter shows from here up to COMMENT_MAX. */
const COUNTER_FROM = 1800

const URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g

const failed = (e: unknown) =>
  e instanceof ApiError ? e.message : "Couldn't save that. Check your connection."

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

/** A comment box: Enter sends, Shift+Enter is a new line, a counter near the limit. */
function CommentBox({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  onEscape,
  disabled,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  /** Return true when the Escape was handled here (it then goes no further). */
  onEscape?: () => boolean
  disabled: boolean
}) {
  return (
    <textarea
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      value={value}
      maxLength={COMMENT_MAX}
      rows={Math.min(6, Math.max(1, value.split("\n").length))}
      // biome-ignore lint/a11y/noAutofocus: a new comment, a reply, or an edit starts typing here
      autoFocus
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onSubmit()
        }
        if (e.key === "Escape" && onEscape?.()) e.stopPropagation()
      }}
      className="min-h-9 flex-1 resize-none rounded-lg border border-input bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    />
  )
}

function Counter({ length }: { length: number }) {
  if (length < COUNTER_FROM) return null
  return (
    <p className="type-caption text-muted-foreground">
      {length.toLocaleString()} / {COMMENT_MAX.toLocaleString()}
    </p>
  )
}

type CardContext = {
  boardId: string
  thread: ThreadView
  canWrite: boolean
  isOwner: boolean
  youId: string | null
  online: boolean
  /** Puts a server answer in the cache (null: the Thread is gone). */
  apply: (thread: ThreadView | null) => void
}

function Comment({ comment, context }: { comment: CommentView; context: CardContext }) {
  const { boardId, thread, canWrite, isOwner, youId, online, apply } = context
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(comment.body)
  const mine = comment.author !== null && comment.author.id === youId
  const canEditIt = mine && canWrite && online
  const canDeleteIt = !comment.deleted && online && ((mine && canWrite) || isOwner)

  const edit = useMutation({
    mutationFn: (body: string) => api.editComment(boardId, thread.id, comment.id, { body }),
    onSuccess: (saved) => {
      apply(saved)
      setEditing(false)
    },
    onError: (e) => toast(failed(e)),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteComment(boardId, thread.id, comment.id),
    onSuccess: (res) => apply(res.thread),
    onError: (e) => toast(failed(e)),
  })

  const name = comment.deleted ? "" : (comment.author?.name ?? "Deleted user")
  return (
    <li className="group/comment flex gap-2.5">
      <span
        aria-hidden
        className="type-label flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-white"
        style={comment.author ? { background: presenceColor(comment.author.id) } : undefined}
      >
        {comment.author ? initials(name) : ""}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {!comment.deleted && (
          <span className="flex items-baseline gap-1.5">
            <span className="type-body-strong truncate">{name}</span>
            <span className="type-caption shrink-0 text-muted-foreground">
              {timeAgo(comment.createdAt)}
              {comment.editedAt && " · edited"}
            </span>
          </span>
        )}
        {comment.deleted ? (
          <p className="text-muted-foreground italic">Comment deleted</p>
        ) : editing ? (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (text.trim()) edit.mutate(text.trim())
            }}
          >
            <CommentBox
              label="Edit comment"
              placeholder="Comment"
              value={text}
              onChange={setText}
              onSubmit={() => text.trim() && edit.mutate(text.trim())}
              onEscape={() => {
                setEditing(false)
                setText(comment.body)
                return true
              }}
              disabled={edit.isPending}
            />
            <Counter length={text.length} />
            <div className="flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  setEditing(false)
                  setText(comment.body)
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="xs" disabled={edit.isPending || !text.trim()}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          <Body text={comment.body} />
        )}
      </div>
      {(canEditIt || canDeleteIt) && !editing && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Actions for ${name || "comment"}'s comment`}
                className="opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
              />
            }
          >
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            {canEditIt && (
              <DropdownMenuItem onClick={() => setEditing(true)}>Edit</DropdownMenuItem>
            )}
            {canDeleteIt && (
              <DropdownMenuItem variant="destructive" onClick={() => remove.mutate()}>
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  )
}

/** Resolve / Reopen, and the Owner's Delete thread (confirmed). */
function ThreadActions({ context }: { context: CardContext }) {
  const { boardId, thread, canWrite, isOwner, online, apply } = context
  const [confirming, setConfirming] = useState(false)
  const resolved = thread.status === "resolved"
  const status = useMutation({
    mutationFn: () => api.setThreadStatus(boardId, thread.id, resolved ? "reopen" : "resolve"),
    onSuccess: (saved) => {
      apply(saved)
      // A resolved Thread's pin hides (unless Show resolved is on), so its card closes too.
      if (saved.status === "resolved" && !useComments.getState().showResolved) {
        useComments.getState().close()
      }
    },
    onError: (e) => toast(failed(e)),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteThread(boardId, thread.id),
    onSuccess: () => {
      setConfirming(false)
      apply(null)
    },
    onError: (e) => toast(failed(e)),
  })
  if (!canWrite && !isOwner) return null
  return (
    <div className="flex items-center justify-end gap-1 border-b px-2 py-1.5">
      {canWrite && (
        <Button
          variant="ghost"
          size="xs"
          disabled={!online || status.isPending}
          onClick={() => status.mutate()}
        >
          {resolved ? <RotateCcw /> : <Check />}
          {resolved ? "Reopen" : "Resolve"}
        </Button>
      )}
      {isOwner && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-xs" aria-label="Thread actions" />}
            >
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                variant="destructive"
                disabled={!online}
                onClick={() => setConfirming(true)}
              >
                Delete thread
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title="Delete this thread?"
            description="Every comment in it goes, for everyone on the board."
            confirmLabel="Delete thread"
            pending={remove.isPending}
            onConfirm={() => remove.mutate()}
          />
        </>
      )}
    </div>
  )
}

export function ThreadCard({
  boardId,
  thread,
  detached = false,
  canWrite,
  isOwner = false,
  youId = null,
  online,
  style,
}: {
  boardId: string
  /** Null for a new Thread that isn't saved yet. */
  thread: ThreadView | null
  /** Its Element was deleted: the pin stays where it was (ADR 0012). */
  detached?: boolean
  canWrite: boolean
  isOwner?: boolean
  youId?: string | null
  online: boolean
  style: React.CSSProperties
}) {
  const queryClient = useQueryClient()
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const apply = (saved: ThreadView | null) => {
    queryClient.setQueryData<ThreadView[]>(queryKeys.threads(boardId), (old) =>
      saved ? upsertThread(old ?? [], saved) : (old ?? []).filter((t) => t.id !== thread?.id),
    )
    if (!saved) useComments.getState().close()
  }
  const send = useMutation({
    mutationFn: async (body: string) => {
      if (thread) return api.reply(boardId, thread.id, { body })
      const anchor = useComments.getState().draft
      if (!anchor) throw new Error("no draft")
      return api.createThread(boardId, { anchor, body })
    },
    onSuccess: (saved) => {
      apply(saved)
      setText("")
      setError(null)
      if (!thread) {
        useComments.getState().openThread(saved.id)
        useBoardUi.getState().setTool("select")
      }
    },
    onError: (e) => setError(failed(e)),
  })

  function submit() {
    const body = text.trim()
    if (body && !send.isPending) send.mutate(body)
  }

  const context = thread ? { boardId, thread, canWrite, isOwner, youId, online, apply } : null
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
      {context && <ThreadActions context={context} />}
      {detached && (
        <p className="type-caption border-b px-3 py-2 text-muted-foreground">
          Detached: its element was deleted. Undo brings it back.
        </p>
      )}
      {context && (
        <ul className="flex flex-col gap-3 overflow-y-auto p-3">
          {context.thread.comments.map((c) => (
            <Comment key={c.id} comment={c} context={context} />
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
            <CommentBox
              label={thread ? "Reply" : "Comment"}
              placeholder={
                !online ? "Comments need a connection" : thread ? "Reply…" : "Add a comment…"
              }
              value={text}
              onChange={(value) => {
                setText(value)
                setError(null)
              }}
              onSubmit={submit}
              // Escape with nothing typed drops a new Thread (DESIGN.md → Comment tool).
              onEscape={() => {
                if (thread || text.trim() !== "") return false
                useComments.getState().close()
                useBoardUi.getState().setTool("select")
                return true
              }}
              disabled={!online}
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
          <Counter length={text.length} />
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
