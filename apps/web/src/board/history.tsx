import { applyRestore } from "@syncanvas/board-model"
import type { VersionInfo } from "@syncanvas/shared"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { History, Loader2, X } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import * as Y from "yjs"
import { create } from "zustand"
import { Button } from "@/components/ui/button"
import { api, queryKeys } from "@/lib/api"
import { cn } from "@/lib/utils"

// Version history (DESIGN.md → Version history; M5b ticket 07), for Editors and the Owner:
// a right-hand panel of Versions by day; choosing one previews it read-only on the canvas
// under a banner, and Restore applies the difference from now as one undoable edit.

type Preview = { version: VersionInfo; doc: Y.Doc }

type HistoryState = { open: boolean; preview: Preview | null }

export const useHistory = create<HistoryState>(() => ({ open: false, preview: null }))

export function openHistory() {
  useHistory.setState({ open: true })
}

/** Leaves history: the panel closes and the live Board comes back. */
export function closeHistory() {
  useHistory.setState({ open: false, preview: null })
}

const timeOf = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(iso))
const dateTimeOf = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso))

/** "Today", "Yesterday", or the date, in the viewer's own time. */
function dayLabel(iso: string, now = new Date()) {
  const day = new Date(iso)
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(day)) / (24 * 60 * 60 * 1000))
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(day.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(day)
}

function byDay(versions: readonly VersionInfo[]) {
  const groups: { label: string; versions: VersionInfo[] }[] = []
  for (const version of versions) {
    const label = dayLabel(version.at)
    const last = groups.at(-1)
    if (last?.label === label) last.versions.push(version)
    else groups.push({ label, versions: [version] })
  }
  return groups
}

/** The right-hand panel. */
export function HistoryPanel({ boardId }: { boardId: string }) {
  const open = useHistory((s) => s.open)
  const preview = useHistory((s) => s.preview)
  const [loading, setLoading] = useState<number | null>(null)
  const versions = useQuery({
    queryKey: queryKeys.versions(boardId),
    queryFn: () => api.versions(boardId),
    enabled: open,
    staleTime: 0,
  })
  if (!open) return null

  const choose = async (version: VersionInfo) => {
    setLoading(version.id)
    try {
      const state = await api.versionState(boardId, version.id)
      const doc = new Y.Doc()
      Y.applyUpdate(doc, state)
      // Still the one asked for (not closed, or another picked meanwhile).
      if (useHistory.getState().open) useHistory.setState({ preview: { version, doc } })
    } catch {
      toast.error("Couldn't open that version", { description: "Try again in a moment." })
    } finally {
      setLoading(null)
    }
  }

  const list = versions.data?.versions ?? []
  return (
    <aside
      aria-label="Version history"
      className="fixed top-16 right-3 bottom-16 z-10 flex w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl bg-surface shadow-panel"
    >
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
        <h2 className="type-body-strong">Version history</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={closeHistory}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {versions.isPending ? (
          <p className="flex items-center justify-center gap-2 px-3 py-6 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : versions.isError ? (
          <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-muted-foreground">
            <p>Couldn't load the history.</p>
            <Button variant="outline" size="sm" onClick={() => versions.refetch()}>
              Try again
            </Button>
          </div>
        ) : list.length === 0 ? (
          <p className="px-3 py-6 text-center text-muted-foreground">
            No versions yet. They're saved as the board changes.
          </p>
        ) : (
          byDay(list).map((group) => (
            <section key={group.label} aria-label={group.label} className="pb-1">
              <h3 className="type-caption px-3 pt-2 pb-1 text-muted-foreground">{group.label}</h3>
              {group.versions.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  aria-pressed={preview?.version.id === version.id}
                  onClick={() => choose(version)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    preview?.version.id === version.id &&
                      "bg-primary-subtle hover:bg-primary-subtle",
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="type-body">{timeOf(version.at)}</span>
                    {version.kind === "restore" && version.by && (
                      <span className="type-caption truncate text-muted-foreground">
                        Restored by {version.by}
                      </span>
                    )}
                  </span>
                  {loading === version.id && (
                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                  )}
                </button>
              ))}
            </section>
          ))
        )}
      </div>
    </aside>
  )
}

/**
 * The banner over a previewed Version: Restore applies it to the live Board `doc` (one undo
 * step for this tab), then tells the room so it keeps a "restored" Version.
 */
export function PreviewBanner({
  boardId,
  doc,
  origin,
  undoManager,
}: {
  boardId: string
  doc: Y.Doc
  origin: object
  undoManager: Y.UndoManager
}) {
  const preview = useHistory((s) => s.preview)
  const queryClient = useQueryClient()
  const [restoring, setRestoring] = useState(false)

  // Escape goes back to the live Board.
  useEffect(() => {
    if (!preview) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") useHistory.setState({ preview: null })
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [preview])

  if (!preview) return null
  const when = dateTimeOf(preview.version.at)

  const restore = async () => {
    setRestoring(true)
    undoManager.stopCapturing()
    applyRestore(doc, preview.doc, origin)
    closeHistory()
    toast(`Restored the version from ${when}`)
    try {
      await api.noteRestore(boardId, preview.version.id)
      void queryClient.invalidateQueries({ queryKey: queryKeys.versions(boardId) })
    } catch {
      // The restore itself stands (it's an ordinary edit); only its "Restored by" entry is lost.
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div
      role="status"
      className="fixed top-16 left-1/2 z-10 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-surface py-1.5 pr-1.5 pl-4 shadow-panel md:top-3"
    >
      <History className="size-4 shrink-0 text-muted-foreground" />
      <span className="type-body-strong truncate">Viewing {when}</span>
      <Button size="sm" className="rounded-full" disabled={restoring} onClick={restore}>
        Restore
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="rounded-full"
        onClick={() => useHistory.setState({ preview: null })}
      >
        Back to current
      </Button>
    </div>
  )
}
