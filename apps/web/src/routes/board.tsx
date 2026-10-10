import { elementsOf } from "@syncanvas/board-model"
import { canEdit } from "@syncanvas/shared"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ChevronDown, CloudOff, Eye, Loader2, Lock } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import * as Y from "yjs"
import { BoardCanvas, type CanvasHandle } from "@/board/board-canvas"
import { Dock, UndoZoomPill } from "@/board/chrome"
import { useBoardUi } from "@/board/store"
import { BrandMark } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ConnectionStatus } from "@/sync/board-connection"
import { useBoardConnection } from "@/sync/use-board-connection"

const route = getRouteApi("/authed/b/$boardId")

/** Board screen (DESIGN.md → Layout → Board screen, "Dock tray"). */
export function BoardScreen() {
  const { boardId } = route.useParams()
  const { status, board, role, doc } = useBoardConnection(boardId)

  if (status === "revoked") return <NoAccess />

  return (
    <TooltipProvider delay={400}>
      <div className="fixed inset-0 overflow-hidden bg-background">
        {doc && <BoardSurface doc={doc} editable={role ? canEdit(role) : false} />}
        <TitlePill title={board?.title} status={status} readOnly={role ? !canEdit(role) : false} />
      </div>
    </TooltipProvider>
  )
}

function BoardSurface({ doc, editable }: { doc: Y.Doc; editable: boolean }) {
  // This tab's transaction origin: the UndoManager only tracks (and undoes) these.
  const origin = useMemo(() => ({ tab: "local" }), [])
  // Created inside the effect (not useMemo) so React's development double-mount gets a live
  // manager, not one destroyed by the simulated unmount.
  const [undoManager, setUndoManager] = useState<Y.UndoManager | null>(null)
  useEffect(() => {
    // captureTimeout: Infinity + stopCapturing() at each gesture start = one gesture per undo step.
    const manager = new Y.UndoManager(elementsOf(doc), {
      trackedOrigins: new Set([origin]),
      captureTimeout: Number.POSITIVE_INFINITY,
    })
    setUndoManager(manager)
    return () => manager.destroy()
  }, [doc, origin])

  // Opening a Board starts with the select tool and nothing selected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the doc changes
  useEffect(() => {
    useBoardUi.setState({ tool: "select", selection: new Set() })
  }, [doc])

  const canvas = useRef<CanvasHandle>(null)
  if (!undoManager) return null
  return (
    <>
      <BoardCanvas
        ref={canvas}
        doc={doc}
        origin={origin}
        undoManager={undoManager}
        canEdit={editable}
      />
      <Dock doc={doc} origin={origin} canEdit={editable} />
      <UndoZoomPill undoManager={undoManager} canvas={canvas} canEdit={editable} />
    </>
  )
}

/** Top-left title pill. The Board menu (rename, theme, export…) arrives in M1. */
function TitlePill({
  title,
  status,
  readOnly,
}: {
  title?: string
  status: ConnectionStatus
  readOnly: boolean
}) {
  return (
    <Link
      to="/"
      aria-label="Back to your boards"
      className={cn(
        "fixed top-3 left-3 flex h-10 items-center gap-2 rounded-full bg-surface pr-4 pl-3 shadow-panel",
        status === "offline" && "ring-1 ring-warning",
      )}
    >
      <BrandMark className="size-5" />
      <span className="type-body-strong max-w-64 truncate">{title ?? "Loading…"}</span>
      <ChevronDown className="size-4 text-muted-foreground" />
      {status === "connecting" && (
        <span className="type-label flex items-center gap-1 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Connecting…
        </span>
      )}
      {status === "offline" && (
        <span className="type-label flex items-center gap-1 text-warning">
          <CloudOff className="size-3.5" /> Offline
        </span>
      )}
      {status === "online" && readOnly && (
        <span className="type-label flex items-center gap-1 text-muted-foreground">
          <Eye className="size-3.5" /> View only
        </span>
      )}
    </Link>
  )
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
