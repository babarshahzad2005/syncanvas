import { worldToScreen } from "@syncanvas/renderer"
import type { ElementBox, ThreadView } from "@syncanvas/shared"
import { Check } from "lucide-react"
import { useEffect } from "react"
import { initials } from "@/components/account-menu"
import { cn } from "@/lib/utils"
import { anchorPoint, useCanvasView, useComments } from "./store"
import { ThreadCard } from "./thread-card"

// Comment pins over the canvas (DESIGN.md → Comment pins; M4 tickets 01–02): a 28px teardrop
// whose point sits on its anchor, placed with the canvas camera on every frame it draws, so
// pins follow pans, zooms, and Elements moving. A pin whose Element is gone stays where the
// Element was, faded and dashed (a Detached Thread). Resolved pins hide unless "Show
// resolved" is on. Clicking a pin opens its Thread card beside it.

const PIN = 28
const CARD_W = 320
const GAP = 8

/** Clicks inside these don't close the card: the card, pins, and its menus and dialogs. */
const KEEPS_CARD_OPEN = "[data-comment-ui], [role='menu'], [role='dialog'], [role='alertdialog']"

type Props = {
  boardId: string
  threads: readonly ThreadView[]
  lastBoxes: ReadonlyMap<string, ElementBox>
  online: boolean
  /** Commenter and above, signed in (Guests never write). */
  canWrite: boolean
  isOwner: boolean
  youId: string | null
}

export function PinLayer({ boardId, threads, lastBoxes, online, canWrite, isOwner, youId }: Props) {
  const { camera, boxOf } = useCanvasView()
  useCanvasView((s) => s.frame) // re-place pins on every canvas frame
  const open = useComments((s) => s.open)
  const draft = useComments((s) => s.draft)
  const showResolved = useComments((s) => s.showResolved)

  // A click anywhere else on the Board closes the card (Escape does too, from the card).
  useEffect(() => {
    if (!open && !draft) return
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest(KEEPS_CARD_OPEN)) return
      useComments.getState().close()
    }
    window.addEventListener("pointerdown", onPointerDown, true)
    return () => window.removeEventListener("pointerdown", onPointerDown, true)
  }, [open, draft])

  const screenOf = (anchor: ThreadView["anchor"]) => {
    const world = anchorPoint(anchor, boxOf, lastBoxes)
    return world ? { ...worldToScreen(camera, world), detached: world.detached } : null
  }

  const shown = threads.filter((t) => t.status === "open" || showResolved || t.id === open)
  const openThread = open ? (threads.find((t) => t.id === open) ?? null) : null
  const cardAnchor = openThread?.anchor ?? draft
  const cardAt = cardAnchor ? screenOf(cardAnchor) : null
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
        const at = screenOf(thread.anchor)
        if (!at) return null
        const first = thread.comments[0]
        // No author: a deleted first comment, or an account that's gone (M5a ticket 06).
        const author = first?.author?.name ?? (first?.deleted ? "Comment" : "Deleted user")
        const resolved = thread.status === "resolved"
        return (
          <button
            key={thread.id}
            type="button"
            data-comment-ui
            data-detached={at.detached || undefined}
            aria-label={`Comment by ${author}: ${first?.body.slice(0, 60) ?? ""}${at.detached ? " (detached)" : ""}${resolved ? " (resolved)" : ""}`}
            aria-pressed={open === thread.id}
            title={at.detached ? "Detached: its element was deleted" : undefined}
            onClick={() => useComments.getState().openThread(open === thread.id ? null : thread.id)}
            className={cn(
              "type-label pointer-events-auto absolute top-0 left-0 flex items-center justify-center rounded-[50%_50%_50%_0] bg-surface text-[10px] shadow-panel outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring",
              at.detached && "border border-muted-foreground border-dashed opacity-50",
              resolved && "text-muted-foreground",
              open === thread.id && "ring-2 ring-primary",
            )}
            style={{
              width: PIN,
              height: PIN,
              transform: `translate(${at.x}px, ${at.y - PIN}px)`,
            }}
          >
            {resolved ? (
              <Check className="size-3.5" />
            ) : thread.comments.length > 1 ? (
              thread.comments.length
            ) : (
              initials(author)
            )}
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
            detached={cardAt.detached}
            canWrite={canWrite}
            isOwner={isOwner}
            youId={youId}
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
