import { createUndoManager } from "@syncanvas/board-model"
import { canEdit, normalizeDisplayName } from "@syncanvas/shared"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import { ChevronDown, CloudOff, Eye, Loader2, Lock } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import type * as Y from "yjs"
import { BoardCanvas, type CanvasHandle } from "@/board/board-canvas"
import { Dock, UndoZoomPill } from "@/board/chrome"
import { errorMessage, ROLE_LABEL, ShareButton } from "@/board/share-dialog"
import { ShortcutSheet } from "@/board/shortcut-sheet"
import { useBoardUi } from "@/board/store"
import { BrandMark } from "@/components/brand"
import { NameDialog } from "@/components/name-dialog"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { toastOnNextPage } from "@/lib/next-page-toast"
import { cn } from "@/lib/utils"
import { FollowFrame } from "@/presence/follow-frame"
import { PresencePill } from "@/presence/presence-pill"
import type { BoardConnection, ConnectionStatus } from "@/sync/board-connection"
import { useBoardConnection } from "@/sync/use-board-connection"

const route = getRouteApi("/authed/b/$boardId")

/** Board screen (DESIGN.md → Layout → Board screen, "Dock tray"). */
export function BoardScreen() {
  const { boardId } = route.useParams()
  const { connection, status, board, role, doc } = useBoardConnection(boardId)
  const navigate = useNavigate()
  const leaving = useRef(false)

  // The Owner changed your Role: the Board has already switched; say who did it.
  useEffect(
    () =>
      connection?.subscribeAccess((notice) => {
        if (notice.role) toast(`${notice.by} changed your role to ${ROLE_LABEL[notice.role]}`)
      }),
    [connection],
  )

  // Removed while here (not left yourself): back to the dashboard, which says why.
  const removedLive = status === "revoked" && connection?.notice?.role === null
  useEffect(() => {
    if (!removedLive || leaving.current) return
    toastOnNextPage(`You no longer have access to “${board?.title ?? "this board"}”`)
    void navigate({ to: "/" })
  }, [removedLive, board?.title, navigate])

  async function leave() {
    const you = connection?.you
    if (!you) return
    leaving.current = true
    try {
      await api.removeMember(boardId, you.id)
    } catch (error) {
      leaving.current = false
      toast(errorMessage(error))
      return
    }
    toastOnNextPage(`You left “${board?.title ?? "the board"}”`)
    await navigate({ to: "/" })
  }

  if (removedLive || leaving.current) return null
  if (status === "revoked") return <NoAccess />

  return (
    <TooltipProvider delay={400}>
      {/* clip, not hidden: a text editor running off-screen must never scroll the Board. */}
      <div className="fixed inset-0 overflow-clip bg-background">
        {doc && (
          <BoardSurface doc={doc} connection={connection} editable={role ? canEdit(role) : false} />
        )}
        <TitlePill title={board?.title} status={status} readOnly={role ? !canEdit(role) : false} />
        {/* Top right: the presence pill, then Share (DESIGN.md → Board screen). */}
        <div className="fixed top-3 right-3 flex items-center gap-2">
          <PresencePill connection={connection} />
          {role && <ShareButton boardId={boardId} title={board?.title} onLeave={leave} />}
        </div>
        <FollowFrame connection={connection} />
      </div>
      <Toaster placement="board" />
      <ShortcutSheet />
      <FirstNamePrompt />
    </TooltipProvider>
  )
}

/** Asks a User without a display name for one, once (DESIGN.md → Display name). */
function FirstNamePrompt() {
  const { data: session } = authClient.useSession()
  const [answered, setAnswered] = useState(false)
  const user = session?.user
  if (!user) return null
  return (
    <NameDialog
      user={user}
      mode="first"
      open={!answered && normalizeDisplayName(user.name) === null}
      onOpenChange={(open) => setAnswered(!open)}
    />
  )
}

function BoardSurface({
  doc,
  connection,
  editable,
}: {
  doc: Y.Doc
  connection: BoardConnection | null
  editable: boolean
}) {
  // This tab's transaction origin: the UndoManager only tracks (and undoes) these.
  const origin = useMemo(() => ({ tab: "local" }), [])
  // Created inside the effect (not useMemo) so React's development double-mount gets a live
  // manager, not one destroyed by the simulated unmount.
  const [undoManager, setUndoManager] = useState<Y.UndoManager | null>(null)
  useEffect(() => {
    const manager = createUndoManager(doc, origin)
    setUndoManager(manager)
    return () => manager.destroy()
  }, [doc, origin])

  // Opening a Board starts with the select tool and nothing selected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the doc changes
  useEffect(() => {
    useBoardUi.setState({ tool: "select", selection: new Set(), following: null })
  }, [doc])
  // Downgraded to read-only (M3 ticket 02): put the tools away.
  useEffect(() => {
    if (!editable) useBoardUi.setState({ tool: "select" })
  }, [editable])

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
        connection={connection}
      />
      <Dock doc={doc} origin={origin} undoManager={undoManager} canEdit={editable} />
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
      title={status === "offline" ? "You're offline. Changes are saved on this device." : undefined}
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
