import { BOARDS_PER_USER, TRASH_DAYS, type TrashedBoard, trashDaysLeft } from "@syncanvas/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronRight, RotateCcw, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { errorMessage } from "@/board/share-dialog"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/toaster"
import { api, queryKeys } from "@/lib/api"
import { timeAgo } from "@/lib/time"
import { DashboardHeader } from "@/routes/dashboard"

/**
 * The Owner's Trash (M5a ticket 03; DESIGN.md → Trash page): deleted Boards, each with
 * Restore and Delete forever, until the daily cleanup deletes them after 30 days.
 */
export function TrashPage() {
  const dashboard = useQuery({ queryKey: queryKeys.dashboard, queryFn: api.dashboard })
  const trash = dashboard.data?.trash ?? []
  return (
    <div className="flex min-h-svh flex-col">
      <DashboardHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pt-4 pb-16 md:px-8">
        <nav aria-label="Breadcrumb" className="type-title flex items-center gap-2">
          <Link to="/" className="text-muted-foreground hover:text-foreground">
            Home
          </Link>
          <ChevronRight className="size-5 text-muted-foreground" />
          <h1>Trash</h1>
        </nav>
        <p className="text-muted-foreground">
          Boards in Trash are deleted for good after {TRASH_DAYS} days. They don't count toward your{" "}
          {BOARDS_PER_USER} boards.
        </p>
        {dashboard.isSuccess && trash.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
            Trash is empty.
          </div>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border bg-surface">
            {trash.map((board) => (
              <TrashRow key={board.id} board={board} />
            ))}
          </ul>
        )}
      </main>
      <Toaster placement="page" />
    </div>
  )
}

function TrashRow({ board }: { board: TrashedBoard }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
  const restore = useMutation({
    mutationFn: () => api.restoreBoard(board.id),
    onSuccess: async () => {
      toast(`Restored “${board.title}”`)
      await refresh()
    },
    onError: (e) => toast(errorMessage(e)),
  })
  const purge = useMutation({
    mutationFn: () => api.deleteForever(board.id),
    onSuccess: async () => {
      setConfirming(false)
      toast(`Deleted “${board.title}” for good`)
      await refresh()
    },
    onError: (e) => toast(errorMessage(e)),
  })
  const left = trashDaysLeft(board.deletedAt)
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
      <div className="flex min-w-0 flex-1 basis-56 flex-col">
        <span className="type-body-strong truncate">{board.title}</span>
        <span className="type-caption text-muted-foreground">
          Deleted {timeAgo(board.deletedAt)} · {left === 1 ? "1 day" : `${left} days`} left
        </span>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          aria-label={`Restore ${board.title}`}
          disabled={restore.isPending}
          onClick={() => restore.mutate()}
        >
          <RotateCcw /> Restore
        </Button>
        <Button
          variant="ghost"
          className="text-destructive"
          aria-label={`Delete ${board.title} forever`}
          onClick={() => setConfirming(true)}
        >
          <Trash2 /> Delete forever
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete “${board.title}” forever?`}
        description="Its content, comments, and everyone's access go for good. This can't be undone."
        confirmLabel="Delete forever"
        pending={purge.isPending}
        onConfirm={() => purge.mutate()}
      />
    </li>
  )
}
