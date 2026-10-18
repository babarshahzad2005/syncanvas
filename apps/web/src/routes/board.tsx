import { applyTemplate, createUndoManager, indexById, listElements } from "@syncanvas/board-model"
import {
  canComment,
  canEdit,
  canRename,
  type ElementBox,
  type InviteRole,
  normalizeDisplayName,
  type ThreadView,
} from "@syncanvas/shared"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router"
import {
  ChevronDown,
  CloudOff,
  Download,
  Eye,
  LayoutGrid,
  Loader2,
  Lock,
  Pencil,
  Trash2,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import type * as Y from "yjs"
import { BoardCanvas, type CanvasHandle } from "@/board/board-canvas"
import { Dock, UndoZoomPill } from "@/board/chrome"
import { pictureOf } from "@/board/clipboard"
import { errorMessage, ROLE_LABEL, ShareButton } from "@/board/share-dialog"
import { ShortcutSheet } from "@/board/shortcut-sheet"
import { useBoardUi } from "@/board/store"
import { CommentsButton } from "@/comments/comments-button"
import { PinLayer } from "@/comments/pin-layer"
import { anchorPoint, useCanvasView, useComments } from "@/comments/store"
import { useThreads } from "@/comments/use-threads"
import { BrandMark } from "@/components/brand"
import { DeleteBoardDialog } from "@/components/delete-board-dialog"
import { NameDialog } from "@/components/name-dialog"
import { NotificationBell } from "@/components/notification-bell"
import { RenameDialog } from "@/components/rename-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ApiError, api, queryKeys } from "@/lib/api"
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
  const { s: linkToken } = route.useSearch()
  const { session } = route.useRouteContext()
  // Opened from a Share Link: signed out, look as a Guest (M3 ticket 04); signed in, join
  // first, then open the Board as a Member (ticket 03).
  if (linkToken && !session) return <BoardView boardId={boardId} guestLink={linkToken} />
  if (linkToken) return <JoinByLink boardId={boardId} token={linkToken} />
  return <BoardView boardId={boardId} />
}

/**
 * Joins through the Share Link, then drops `?s=` from the address (it's the Owner's to
 * share, and a Member doesn't need it) and opens the Board.
 */
function JoinByLink({ boardId, token }: { boardId: string; token: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    api.join(boardId, token).then(
      async () => {
        if (cancelled) return
        await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
        await navigate({ to: "/b/$boardId", params: { boardId }, search: {}, replace: true })
      },
      (error) => {
        if (cancelled) return
        setFailed(
          error instanceof ApiError
            ? error.message
            : "Couldn't open the link. Check your connection and try again.",
        )
      },
    )
    return () => {
      cancelled = true
    }
  }, [boardId, token, navigate, queryClient])

  if (failed) {
    return (
      <Notice
        title="This link doesn't work"
        body={failed}
        action={
          <Button nativeButton={false} render={<Link to="/" />}>
            Back to your boards
          </Button>
        }
      />
    )
  }
  return (
    <main className="flex min-h-svh items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Opening the board…
    </main>
  )
}

const NO_BOXES = new Map<string, ElementBox>()

/**
 * Made from a template (`?template=`, M5a ticket 04): once synced, an empty Board gets the
 * template's Elements as this tab's first edit (so undo removes them), the view fits them,
 * and the parameter goes. A Board that already has content is left alone.
 */
function useTemplateFromLink(
  doc: Y.Doc,
  origin: unknown,
  ready: boolean,
  canvas: React.RefObject<CanvasHandle | null>,
) {
  const { template } = route.useSearch()
  const navigate = useNavigate()
  const handled = useRef(false)
  useEffect(() => {
    if (!template || !ready || handled.current) return
    handled.current = true
    if (listElements(doc).length === 0) {
      applyTemplate(doc, template, origin)
      // After the canvas has drawn the new Elements.
      requestAnimationFrame(() => canvas.current?.fit())
    }
    void navigate({ to: ".", search: (prev) => ({ ...prev, template: undefined }), replace: true })
  }, [template, ready, doc, origin, canvas, navigate])
}

/**
 * Opened from a Notification (`?thread=`): once that Thread is loaded and the canvas is
 * drawing, center its pin, open its card, and drop the parameter (M4 ticket 03).
 */
function useThreadFromLink(
  threads: readonly ThreadView[],
  lastBoxes: ReadonlyMap<string, ElementBox>,
) {
  const { thread: wanted } = route.useSearch()
  const navigate = useNavigate()
  const frame = useCanvasView((s) => s.frame)
  // Once per link: leaving the address takes a moment, and every frame in between would
  // otherwise open the card and move the view again.
  const handled = useRef<string | null>(null)
  useEffect(() => {
    if (!wanted || frame === 0 || handled.current === wanted) return
    const thread = threads.find((t) => t.id === wanted)
    if (!thread) return
    handled.current = wanted
    useComments
      .getState()
      .focus(thread.id, anchorPoint(thread.anchor, useCanvasView.getState().boxOf, lastBoxes))
    void navigate({ to: ".", search: (prev) => ({ ...prev, thread: undefined }), replace: true })
  }, [wanted, frame, threads, lastBoxes, navigate])
}

function BoardView({ boardId, guestLink }: { boardId: string; guestLink?: string }) {
  const { connection, status, board, role, doc, lostWork, discardLocalCopy } = useBoardConnection(
    boardId,
    guestLink,
  )
  const navigate = useNavigate()
  const leaving = useRef(false)
  // Comments (M4): loaded once connected, then kept live by the board room.
  const threads = useThreads(boardId, connection, status === "online")
  useThreadFromLink(threads, connection?.lastBoxes ?? NO_BOXES)

  // The Owner changed your Role: the Board has already switched; say who did it.
  useEffect(
    () =>
      connection?.subscribeAccess((notice) => {
        if (notice.role) toast(`${notice.by} changed your role to ${ROLE_LABEL[notice.role]}`)
      }),
    [connection],
  )

  // Removed while here (not left yourself): back to the dashboard, which says why.
  // Removed while here, or refused on reconnecting after being here (FLOWS §2). A first visit
  // without access gets the no-access page instead; unsaved work gets the picture dialog.
  const deleted = status === "revoked" && connection?.deleted === true
  const removedLive =
    status === "revoked" &&
    !guestLink &&
    (deleted ||
      (!lostWork && (connection?.notice?.role === null || connection?.wasOnline === true)))
  useEffect(() => {
    if (!removedLive || leaving.current) return
    const title = board?.title ?? "this board"
    // The Owner deleted it (M5a ticket 03), or you lost access.
    toastOnNextPage(deleted ? `“${title}” was deleted` : `You no longer have access to “${title}”`)
    void navigate({ to: "/" })
  }, [removedLive, deleted, board?.title, navigate])

  /** The Owner sends the Board to Trash from the Board menu (M5a ticket 03). */
  async function deleteBoard() {
    leaving.current = true
    try {
      await api.deleteBoard(boardId)
    } catch (error) {
      leaving.current = false
      toast(errorMessage(error))
      return
    }
    await discardLocalCopy()
    toastOnNextPage(`“${board?.title ?? "The board"}” moved to Trash`)
    await navigate({ to: "/" })
  }

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
  if (status === "busy") return <Busy />
  if (deleted && guestLink) return <BoardDeleted title={board?.title} />
  if (status === "revoked" && guestLink) return <LinkGone />
  if (status === "revoked" && lostWork && doc) {
    return (
      <LostAccess
        doc={doc}
        title={lostWork.title ?? board?.title ?? null}
        onDiscard={async () => {
          await discardLocalCopy()
          toastOnNextPage(`You no longer have access to “${lostWork.title ?? "this board"}”`)
          await navigate({ to: "/" })
        }}
      />
    )
  }
  if (status === "revoked") return <NoAccess />

  return (
    <TooltipProvider delay={400}>
      {/* clip, not hidden: a text editor running off-screen must never scroll the Board. */}
      <div className="fixed inset-0 overflow-clip bg-background">
        {doc && (
          <BoardSurface
            boardId={boardId}
            doc={doc}
            connection={connection}
            editable={role ? canEdit(role) : false}
            commenter={role !== null && canComment(role) && !guestLink}
            isOwner={role === "owner"}
            online={status === "online"}
            threads={threads}
          />
        )}
        <TitlePill
          boardId={boardId}
          title={board?.title}
          status={status}
          readOnly={role ? !canEdit(role) : false}
          canRename={!guestLink && status === "online" && role !== null && canRename(role)}
          onRenamed={(title) => connection?.renamed(title)}
          onDelete={!guestLink && role === "owner" ? deleteBoard : undefined}
        />
        {/* Top right: the presence pill, then Share (DESIGN.md → Board screen). */}
        <div className="fixed top-3 right-3 flex items-center gap-2">
          {!guestLink && <NotificationBell placement="board" />}
          <PresencePill connection={connection} />
          {doc && (
            <CommentsButton threads={threads} lastBoxes={connection?.lastBoxes ?? NO_BOXES} />
          )}
          {guestLink ? (
            <GuestSignIn linkRole={connection?.linkRole ?? null} />
          ) : (
            role && <ShareButton boardId={boardId} title={board?.title} onLeave={leave} />
          )}
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
  boardId,
  doc,
  connection,
  editable,
  commenter,
  isOwner,
  online,
  threads,
}: {
  boardId: string
  doc: Y.Doc
  connection: BoardConnection | null
  editable: boolean
  /** Commenter and above (M4); comments also need a connection. */
  commenter: boolean
  isOwner: boolean
  online: boolean
  threads: readonly ThreadView[]
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
  // Downgraded to read-only (M3 ticket 02): put the tools away. The comment tool stays for
  // Commenters while connected (M4).
  const canCommentNow = commenter && online
  useEffect(() => {
    const { tool } = useBoardUi.getState()
    const allowed = tool === "select" || (tool === "comment" ? canCommentNow : editable)
    if (!allowed) useBoardUi.setState({ tool: "select" })
  }, [editable, canCommentNow])
  // The Members a comment can mention, fetched once you start commenting (the comment tool,
  // or an open Thread), so they're ready before the first "@" (M4 ticket 03). Not at Board
  // open: that's the busiest moment, and most visits never comment.
  const commenting = useBoardUi((s) => s.tool === "comment")
  const threadOpen = useComments((s) => s.open !== null || s.draft !== null)
  useQuery({
    queryKey: queryKeys.sharing(boardId),
    queryFn: () => api.sharing(boardId),
    enabled: canCommentNow && (commenting || threadOpen),
    staleTime: 60_000,
  })
  // A new Board starts with no Thread open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the doc changes
  useEffect(() => useComments.getState().close(), [doc])

  const canvas = useRef<CanvasHandle>(null)
  useTemplateFromLink(doc, origin, editable && online && undoManager !== null, canvas)
  if (!undoManager) return null
  return (
    <>
      <BoardCanvas
        ref={canvas}
        doc={doc}
        origin={origin}
        undoManager={undoManager}
        canEdit={editable}
        canComment={canCommentNow}
        connection={connection}
      />
      <PinLayer
        boardId={boardId}
        threads={threads}
        lastBoxes={connection?.lastBoxes ?? NO_BOXES}
        online={online}
        canWrite={commenter}
        isOwner={isOwner}
        youId={connection?.you?.id ?? null}
      />
      <Dock
        doc={doc}
        origin={origin}
        undoManager={undoManager}
        canEdit={editable}
        canComment={canCommentNow}
        online={online}
      />
      <UndoZoomPill undoManager={undoManager} canvas={canvas} canEdit={editable} />
    </>
  )
}

/** Top-left title pill. The Board menu (rename, theme, export…) arrives in M1. */
function TitlePill({
  boardId,
  title,
  status,
  readOnly,
  canRename,
  onRenamed,
  onDelete,
}: {
  boardId: string
  title?: string
  status: ConnectionStatus
  readOnly: boolean
  /** The Owner and Editors, while connected (M5a ticket 01). */
  canRename: boolean
  onRenamed: (title: string) => void
  /** The Owner only: sends the Board to Trash (M5a ticket 03). */
  onDelete?: () => Promise<void>
}) {
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pending, setPending] = useState(false)
  return (
    <div
      className={cn(
        "fixed top-3 left-3 flex h-10 items-center rounded-full bg-surface shadow-panel",
        status === "offline" && "ring-1 ring-warning",
      )}
    >
      <Link
        to="/"
        aria-label="Back to your boards"
        title={
          status === "offline" ? "You're offline. Changes are saved on this device." : undefined
        }
        className="flex h-full min-w-0 items-center gap-2 rounded-l-full pl-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BrandMark className="size-5" />
        <span className="type-body-strong max-w-64 truncate">{title ?? "Loading…"}</span>
        <TitleStatus status={status} readOnly={readOnly} />
      </Link>
      {/* The Board menu (DESIGN.md → title pill): rename now; theme and export come later. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Board menu"
              className="ml-1 flex h-full items-center rounded-r-full pr-3 pl-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <ChevronDown className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem disabled={!canRename} onClick={() => setRenaming(true)}>
            <Pencil /> Rename…
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/" />}>
            <LayoutGrid /> Back to your boards
          </DropdownMenuItem>
          {onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                <Trash2 /> Delete board…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {onDelete && (
        <DeleteBoardDialog
          title={title ?? "this board"}
          open={deleting}
          onOpenChange={setDeleting}
          pending={pending}
          onConfirm={async () => {
            setPending(true)
            await onDelete()
            setPending(false)
          }}
        />
      )}
      <RenameDialog
        boardId={boardId}
        title={title ?? ""}
        open={renaming}
        onOpenChange={setRenaming}
        onRenamed={onRenamed}
      />
    </div>
  )
}

/** Connecting, Offline, or View only, after the title. */
function TitleStatus({ status, readOnly }: { status: ConnectionStatus; readOnly: boolean }) {
  return (
    <>
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
    </>
  )
}

function NoAccess() {
  return (
    <Notice
      title="You don't have access to this board"
      body="It may have been deleted, or the owner hasn't shared it with you. Ask them for an invite."
      action={
        <Button nativeButton={false} render={<Link to="/" />}>
          Back to your boards
        </Button>
      }
    />
  )
}

/**
 * A Guest's way in (DESIGN.md → Guests): signing in comes back to this same Share Link, which
 * then makes them a Member with its Role.
 */
function GuestSignIn({ linkRole }: { linkRole: InviteRole | null }) {
  if (!linkRole) return null
  const label =
    linkRole === "editor"
      ? "Sign in to edit"
      : linkRole === "commenter"
        ? "Sign in to comment"
        : "Sign in"
  // A plain link (it navigates), styled as the one primary button.
  return (
    <a
      href={`/sign-in?redirect=${encodeURIComponent(location.pathname + location.search)}`}
      className={cn(buttonVariants(), "h-10 rounded-full px-4 shadow-panel")}
    >
      {label}
    </a>
  )
}

/** The Owner deleted the Board while a Guest had it open (M5a ticket 03). */
function BoardDeleted({ title }: { title?: string }) {
  return (
    <Notice
      title={title ? `“${title}” was deleted` : "This board was deleted"}
      body="Its owner deleted it, so it isn't available anymore."
      action={
        <Button nativeButton={false} render={<Link to="/sign-in" />}>
          Sign in
        </Button>
      }
    />
  )
}

/** A Guest's link was turned off or replaced (M3 ticket 04). */
function LinkGone() {
  return (
    <Notice
      title="This link doesn't work anymore"
      body="The board's owner turned it off or replaced it. Ask them for a new one, or sign in if they've invited you."
      action={
        <Button nativeButton={false} render={<Link to="/sign-in" />}>
          Sign in
        </Button>
      }
    />
  )
}

/** The Board is at its connection cap; the connection tries again every 30 s by itself. */
function Busy() {
  return (
    <Notice
      title="This board is busy right now"
      body="It has as many visitors as it can take. We'll try again every 30 seconds, so you can leave this page open."
      action={
        <span className="type-caption flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Waiting for room…
        </span>
      }
    />
  )
}

/**
 * Access is gone and this device holds edits the room never received (M3 ticket 05; FLOWS §2):
 * offer a picture of the local copy before clearing it. SVG export arrives in M6.
 */
function LostAccess({
  doc,
  title,
  onDiscard,
}: {
  doc: Y.Doc
  title: string | null
  onDiscard: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  // Focus starts on the safe choice: Enter must never throw the work away.
  const downloadButton = useRef<HTMLButtonElement>(null)
  async function download() {
    const elements = listElements(doc)
    const blob = await pictureOf(elements, indexById(elements))
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${(title ?? "board").replace(/[\\/:*?"<>|]+/g, " ").trim() || "board"}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return (
    <>
      <NoAccess />
      <Dialog open onOpenChange={() => {}} disablePointerDismissal>
        <DialogContent
          showCloseButton={false}
          initialFocus={downloadButton}
          className="grid-cols-[minmax(0,1fr)]"
        >
          <div className="flex flex-col gap-1.5">
            <DialogTitle>
              You no longer have access to {title ? `“${title}”` : "this board"}
            </DialogTitle>
            <DialogDescription>
              Changes you made while offline couldn't be saved to the board. Download a picture of
              your copy before it's removed from this device.
            </DialogDescription>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void onDiscard().finally(() => setBusy(false))
              }}
            >
              Discard and close
            </Button>
            <Button ref={downloadButton} disabled={busy} onClick={() => void download()}>
              <Download /> Download a picture
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** A full-page message with a lock (no access, a dead Share Link). */
function Notice({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted">
          <Lock className="size-5 text-muted-foreground" />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="type-title">{title}</h1>
          <p className="text-muted-foreground">{body}</p>
        </div>
        {action}
      </div>
    </main>
  )
}
