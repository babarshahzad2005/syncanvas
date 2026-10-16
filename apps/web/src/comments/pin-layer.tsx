import { worldToScreen } from "@syncanvas/renderer"
import type { ThreadView } from "@syncanvas/shared"
import { useEffect } from "react"
import { initials } from "@/components/account-menu"
import { cn } from "@/lib/utils"
import type { BoardConnection } from "@/sync/board-connection"
import { anchorPoint, useCanvasView, useComments } from "./store"
import { ThreadCard } from "./thread-card"
import { useThreads } from "./use-threads"

// Comment pins over the canvas (DESIGN.md → Comment pins; M4 ticket 01): a 28px teardrop
// whose point sits on its anchor, placed with the canvas camera on every frame it draws, so
// pins follow pans, zooms, and Elements moving. Clicking one opens its Thread card beside it.

const PIN = 28
const CARD_W = 320
const GAP = 8

type Props = {
  boardId: string
  connection: BoardConnection | null
  online: boolean
  /** Commenter and above, signed in (Guests never write). */
  canWrite: boolean
}

export function PinLayer({ boardId, connection, online, canWrite }: Props) {
  const threads = useThreads(boardId, connection, online)
  const { camera, boxOf } = useCanvasView()
  useCanvasView((s) => s.frame) // re-place pins on every canvas frame
  const open = useComments((s) => s.open)
  const draft = useComments((s) => s.draft)

  // A click anywhere else on the Board closes the card (Escape does too, from the card).
  useEffect(() => {
    if (!open && !draft) return
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest("[data-comment-ui]")) return
      useComments.getState().close()
    }
    window.addEventListener("pointerdown", onPointerDown, true)
    return () => window.removeEventListener("pointerdown", onPointerDown, true)
  }, [open, draft])

  const screenOf = (thread: Pick<ThreadView, "anchor" | "last">) => {
    const world = anchorPoint(thread.anchor, boxOf, thread.last)
    return world ? worldToScreen(camera, world) : null
  }

  const shown = threads.filter((t) => t.status === "open" || t.id === open)
  const openThread = open ? (threads.find((t) => t.id === open) ?? null) : null
  const cardAnchor = openThread?.anchor ?? draft
  const cardAt = openThread
    ? screenOf(openThread)
    : draft
      ? screenOf({ anchor: draft, last: null })
      : null
  // The card goes beside the pinned Element as a whole, never over it (DESIGN.md).
  const elementBox = cardAnchor && "elementId" in cardAnchor ? boxOf(cardAnchor.elementId) : null
  const avoid = elementBox
    ? {
        left: worldToScreen(camera, { x: elementBox.x, y: elementBox.y }).x,
        right: worldToScreen(camera, { x: elementBox.x + elementBox.w, y: elementBox.y }).x,
      }
    : null

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {shown.map((thread) => {
        const at = screenOf(thread)
        if (!at) return null
        const first = thread.comments[0]
        const label = first?.author?.name ?? "Comment"
        return (
          <button
            key={thread.id}
            type="button"
            data-comment-ui
            aria-label={`Comment by ${label}: ${first?.body.slice(0, 60) ?? ""}`}
            aria-pressed={open === thread.id}
            onClick={() => useComments.getState().openThread(open === thread.id ? null : thread.id)}
            className={cn(
              "type-label pointer-events-auto absolute top-0 left-0 flex items-center justify-center rounded-[50%_50%_50%_0] bg-surface text-[10px] shadow-panel outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring",
              open === thread.id && "ring-2 ring-primary",
            )}
            style={{
              width: PIN,
              height: PIN,
              transform: `translate(${at.x}px, ${at.y - PIN}px)`,
            }}
          >
            {thread.comments.length > 1 ? thread.comments.length : initials(label)}
          </button>
        )
      })}
      {draft && cardAt && (
        <span
          aria-hidden
          className="absolute top-0 left-0 rounded-[50%_50%_50%_0] bg-surface shadow-panel ring-2 ring-primary"
          style={{
            width: PIN,
            height: PIN,
            transform: `translate(${cardAt.x}px, ${cardAt.y - PIN}px)`,
          }}
        />
      )}
      {cardAt && (openThread || draft) && (
        <div className="pointer-events-auto">
          <ThreadCard
            key={openThread?.id ?? "draft"}
            boardId={boardId}
            thread={openThread}
            canWrite={canWrite}
            online={online}
            style={cardPlacement(cardAt, avoid)}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Beside the pin (or the pinned Element's box, `avoid`), on whichever side has more room; kept
 * on screen.
 */
function cardPlacement(
  pin: { x: number; y: number },
  avoid: { left: number; right: number } | null,
): React.CSSProperties {
  const width = window.innerWidth
  const height = window.innerHeight
  const right = Math.max(pin.x + PIN, avoid?.right ?? 0) + GAP
  const left = Math.min(pin.x, avoid?.left ?? pin.x) - CARD_W - GAP
  const x = width - right >= CARD_W + 12 || left < 12 ? Math.min(right, width - CARD_W - 12) : left
  const y = Math.min(Math.max(12, pin.y - PIN), Math.max(12, height - 220))
  return { left: Math.max(12, x), top: y }
}
