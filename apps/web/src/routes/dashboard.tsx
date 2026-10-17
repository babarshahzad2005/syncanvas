import { type BoardSummary, canRename } from "@syncanvas/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  Columns3,
  Ellipsis,
  ExternalLink,
  FolderInput,
  Lightbulb,
  LogOut,
  Pencil,
  Plus,
  RotateCcw,
  Route,
  Search,
  Star,
  Trash2,
  Workflow,
} from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { errorMessage } from "@/board/share-dialog"
import { AccountMenu } from "@/components/account-menu"
import { BrandMark, Wordmark } from "@/components/brand"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { NotificationBell } from "@/components/notification-bell"
import { RenameDialog } from "@/components/rename-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Toaster } from "@/components/ui/toaster"
import { api, queryKeys } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { showPendingToast } from "@/lib/next-page-toast"
import { timeAgo } from "@/lib/time"
import { cn } from "@/lib/utils"
import { clearLocalCopy } from "@/sync/local-copy"

// Dashboard, "Launcher" layout (DESIGN.md → Layout → Dashboard). Folders, favorites, search,
// templates, and Trash arrive in later milestones; they're shown disabled only where the layout
// needs them.

const TEMPLATES = [
  { id: "blank", name: "Blank board", icon: Plus },
  { id: "retro", name: "Retro", icon: RotateCcw },
  { id: "brainstorm", name: "Brainstorm", icon: Lightbulb },
  { id: "flowchart", name: "Flowchart", icon: Workflow },
  { id: "journey", name: "User journey", icon: Route },
  { id: "kanban", name: "Kanban", icon: Columns3 },
] as const

const FILTERS = ["All", "Mine", "Shared with me", "Favorites"] as const
type Filter = (typeof FILTERS)[number]

export function Dashboard() {
  const { data: session } = authClient.useSession()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>("All")
  // A message from the Board you just left or lost (M3 ticket 02).
  useEffect(() => showPendingToast(), [])

  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: api.dashboard })
  const create = useMutation({
    mutationFn: () => api.createBoard(),
    onSuccess: async (board) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
      await navigate({ to: "/b/$boardId", params: { boardId: board.id } })
    },
  })

  const boards = dashboard.data?.boards ?? []
  const isNewUser = dashboard.isSuccess && boards.length === 0
  const me = session?.user.id
  const shown = boards.filter((b) =>
    filter === "Mine"
      ? b.owner.id === me
      : filter === "Shared with me"
        ? b.owner.id !== me
        : filter === "Favorites"
          ? b.favorite
          : true,
  )

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-16 items-center gap-4 px-4 md:px-8">
        <Wordmark />
        <label
          className="mx-auto hidden h-11 w-full max-w-xl items-center gap-2 rounded-lg border border-input bg-surface px-3 text-muted-foreground opacity-60 md:flex"
          title="Search arrives in a later update"
        >
          <Search className="size-4" />
          <input
            disabled
            placeholder="Search boards and their text"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          />
        </label>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          {session && <NotificationBell placement="page" />}
          {session && <AccountMenu user={session.user} />}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 pt-4 pb-16 md:px-8">
        <section className="flex flex-col gap-4">
          <h1 className={isNewUser ? "type-display" : "type-title"}>
            {isNewUser ? "Let's make your first board" : "Start something new"}
          </h1>
          <div
            className={cn(
              isNewUser
                ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
                : "-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-6 md:overflow-visible md:px-0",
            )}
          >
            {TEMPLATES.map((t) => {
              const blank = t.id === "blank"
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={!blank || create.isPending}
                  title={blank ? undefined : "Templates arrive in a later update"}
                  onClick={() => create.mutate()}
                  className={cn(
                    "flex shrink-0 flex-col items-center justify-center gap-3 rounded-xl border bg-surface transition-[box-shadow,transform] duration-(--duration-press) ease-out hover:shadow-panel active:scale-[0.98] disabled:pointer-events-none",
                    isNewUser ? "aspect-[4/3]" : "h-24 w-36 md:w-auto",
                    blank ? "border-2 border-dashed border-primary/50 text-primary" : "opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center justify-center rounded-full",
                      isNewUser ? "size-10" : "size-8",
                      blank ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                    )}
                  >
                    <t.icon className={isNewUser ? "size-5" : "size-4"} />
                  </span>
                  <span className="type-body-strong">
                    {blank && create.isPending ? "Creating…" : t.name}
                  </span>
                </button>
              )
            })}
          </div>
          {create.isError && (
            <p className="text-destructive">
              We couldn't create the board. Check your connection and try again.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="type-title">Your boards</h2>
            {!isNewUser && (
              <div className="flex rounded-lg bg-muted p-0.5" role="tablist">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={filter === f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "type-label h-7 rounded-md px-3 disabled:opacity-40 pointer-coarse:h-11",
                      filter === f
                        ? "bg-surface text-foreground shadow-panel"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>

          {dashboard.isPending ? (
            <BoardGrid>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex flex-col overflow-hidden rounded-xl border bg-surface">
                  <div className="aspect-[16/10] animate-pulse bg-muted" />
                  <div className="flex flex-col gap-2 p-3">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </BoardGrid>
          ) : dashboard.isError ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
              <p className="text-muted-foreground">
                We couldn't load your boards. Check your connection and try again.
              </p>
              <Button variant="outline" onClick={() => dashboard.refetch()}>
                Try again
              </Button>
            </div>
          ) : shown.length === 0 ? (
            <p className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">
              {isNewUser || filter === "All"
                ? "Boards you open will show up here."
                : filter === "Mine"
                  ? "You haven't created a board yet."
                  : "Boards others share with you will show up here."}
            </p>
          ) : (
            <BoardGrid>
              {shown.map((b) => (
                <BoardTile key={b.id} board={b} me={me} />
              ))}
            </BoardGrid>
          )}
        </section>
      </main>
      <Toaster placement="page" />
    </div>
  )
}

function BoardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
}

function BoardTile({ board, me }: { board: BoardSummary; me?: string }) {
  const isOwner = board.owner.id === me
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const star = useMutation({
    mutationFn: (favorite: boolean) => api.setFavorite(board.id, favorite),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    onError: (e) => toast(errorMessage(e)),
  })
  const leave = useMutation({
    mutationFn: () => api.removeMember(board.id, me ?? ""),
    onSuccess: async () => {
      clearLocalCopy(board.id)
      setConfirming(false)
      toast(`You left “${board.title}”`)
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
    },
    onError: (e) => toast(errorMessage(e)),
  })
  return (
    <div className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-surface transition-shadow hover:shadow-panel">
      <Link to="/b/$boardId" params={{ boardId: board.id }} className="flex flex-col outline-none">
        {/* Thumbnails arrive in M5; until then every Board shows the placeholder. */}
        <div className="dot-grid flex aspect-[16/10] items-center justify-center border-b">
          <BrandMark className="size-6 opacity-30 grayscale" />
        </div>
        <div className="flex flex-col p-3 pr-12">
          <span className="flex items-center gap-1">
            <span className="type-body-strong truncate">{board.title}</span>
            {board.favorite && (
              <Star aria-label="Favorite" className="size-3.5 shrink-0 fill-warning text-warning" />
            )}
          </span>
          <span className="type-caption truncate text-muted-foreground">
            {isOwner ? "" : `${board.owner.name || board.owner.email} · `}
            Edited {timeAgo(board.updatedAt)}
          </span>
        </div>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${board.title}`}
              className="absolute right-2 bottom-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 pointer-coarse:opacity-100"
            />
          }
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem render={<Link to="/b/$boardId" params={{ boardId: board.id }} />}>
            <ExternalLink /> Open
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canRename(board.role)} onClick={() => setRenaming(true)}>
            <Pencil /> Rename…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => star.mutate(!board.favorite)}>
            <Star /> {board.favorite ? "Remove from favorites" : "Add to favorites"}
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <FolderInput /> Move to folder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isOwner ? (
            <DropdownMenuItem disabled variant="destructive">
              <Trash2 /> Delete board
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
              <LogOut /> Leave board
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameDialog
        boardId={board.id}
        title={board.title}
        open={renaming}
        onOpenChange={setRenaming}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Leave “${board.title}”?`}
        description="It leaves your dashboard, and you'll need a new invitation to get back in."
        confirmLabel="Leave board"
        pending={leave.isPending}
        onConfirm={() => leave.mutate()}
      />
    </div>
  )
}
