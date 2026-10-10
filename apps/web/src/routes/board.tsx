import { getRouteApi, Link } from "@tanstack/react-router"
import { ChevronDown, CloudOff, Loader2, Lock } from "lucide-react"
import { BrandMark } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useBoardConnection } from "@/sync/use-board-connection"

const route = getRouteApi("/authed/b/$boardId")

/** Board screen (DESIGN.md → Layout → Board screen, "Dock tray"). The canvas arrives in ticket 08. */
export function BoardScreen() {
  const { boardId } = route.useParams()
  const { status, board } = useBoardConnection(boardId)

  if (status === "revoked") return <NoAccess />

  return (
    <div className="dot-grid fixed inset-0 overflow-hidden">
      {/* Title pill: the Board menu arrives with the canvas chrome (ticket 08). */}
      <Link
        to="/"
        aria-label="Back to your boards"
        className={cn(
          "fixed top-3 left-3 flex h-10 items-center gap-2 rounded-full bg-surface pr-4 pl-3 shadow-panel",
          status === "offline" && "ring-1 ring-warning",
        )}
      >
        <BrandMark className="size-5" />
        <span className="type-body-strong max-w-64 truncate">{board?.title ?? "Loading…"}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
        <ConnectionBadge status={status} />
      </Link>
    </div>
  )
}

function ConnectionBadge({ status }: { status: string }) {
  if (status === "connecting") {
    return (
      <span className="type-label flex items-center gap-1 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Connecting…
      </span>
    )
  }
  if (status === "offline") {
    return (
      <span className="type-label flex items-center gap-1 text-warning">
        <CloudOff className="size-3.5" /> Offline
      </span>
    )
  }
  return null
}

function NoAccess() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted">
          <Lock className="size-5 text-muted-foreground" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="type-title">You don't have access to this board</h1>
          <p className="text-muted-foreground">
            It may have been deleted, or the owner hasn't shared it with you. Ask them for an
            invite.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/" />}>
          Back to your boards
        </Button>
      </div>
    </main>
  )
}
