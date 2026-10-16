import type { ElementBox, ThreadView } from "@syncanvas/shared"
import { MessageCircle } from "lucide-react"
import { useState } from "react"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { timeAgo } from "@/lib/time"
import { anchorPoint, useCanvasView, useComments } from "./store"

// The comment count button and its popover (DESIGN.md → Board screen, top right; M4 ticket
// 02): the open Threads, plus the resolved ones with "Show resolved" on, which also shows
// their pins. Clicking a row brings its pin into view and opens its card.

export function CommentsButton({
  threads,
  lastBoxes,
}: {
  threads: readonly ThreadView[]
  lastBoxes: ReadonlyMap<string, ElementBox>
}) {
  const [opened, setOpened] = useState(false)
  const showResolved = useComments((s) => s.showResolved)
  const open = threads.filter((t) => t.status === "open")
  const resolved = threads.filter((t) => t.status === "resolved")
  const listed = showResolved ? [...open, ...resolved] : open

  function focus(thread: ThreadView) {
    const at = anchorPoint(thread.anchor, useCanvasView.getState().boxOf, lastBoxes)
    useComments.getState().focus(thread.id, at)
    setOpened(false)
  }

  return (
    <Popover open={opened} onOpenChange={setOpened}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Comments (${open.length} unresolved)`}
            className="type-label flex h-10 items-center gap-1.5 rounded-full bg-surface px-3 text-muted-foreground shadow-panel outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground"
          />
        }
      >
        <MessageCircle className="size-4" />
        {open.length}
      </PopoverTrigger>
      <PopoverContent className="flex w-80 flex-col" data-comment-ui>
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
          <PopoverTitle>Comments</PopoverTitle>
          <div className="type-caption flex items-center gap-2 text-muted-foreground">
            Show resolved
            <Switch
              aria-label="Show resolved"
              checked={showResolved}
              onCheckedChange={(on) => useComments.getState().setShowResolved(on)}
            />
          </div>
        </div>
        {listed.length === 0 ? (
          <p className="px-3 py-6 text-center text-muted-foreground">
            {threads.length === 0
              ? "No comments yet. Press M to add one."
              : "No open comments. Turn on Show resolved to see the rest."}
          </p>
        ) : (
          <ul className="flex max-h-96 flex-col overflow-y-auto p-1">
            {listed.map((thread) => {
              const first = thread.comments.find((c) => !c.deleted) ?? thread.comments[0]
              const replies = thread.comments.length - 1
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => focus(thread)}
                    className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                  >
                    <span className="flex items-baseline gap-1.5">
                      <span className="type-body-strong truncate">
                        {first?.author?.name ?? "Comment deleted"}
                      </span>
                      <span className="type-caption shrink-0 text-muted-foreground">
                        {timeAgo(thread.createdAt)}
                        {thread.status === "resolved" && " · resolved"}
                      </span>
                    </span>
                    <span className="truncate text-muted-foreground">
                      {first?.deleted ? "Comment deleted" : first?.body.split("\n")[0]}
                    </span>
                    {replies > 0 && (
                      <span className="type-caption text-muted-foreground">
                        {replies === 1 ? "1 reply" : `${replies} replies`}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
