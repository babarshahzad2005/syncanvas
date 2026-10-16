import type { NotificationView } from "@syncanvas/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Bell } from "lucide-react"
import { useState } from "react"
import { initials } from "@/components/account-menu"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { api, queryKeys } from "@/lib/api"
import { timeAgo } from "@/lib/time"
import { cn } from "@/lib/utils"
import { presenceColor } from "@/presence/model"

// The bell and notification list (DESIGN.md → Bell and notification list; M4 ticket 03): your
// Notifications across all Boards, newest first. On a Board they also arrive live over its
// connection (the board's "notify" signal refetches this list); everywhere the list is
// checked every 30 s while the tab is visible, and when it gets focus.

const CHECK_EVERY = 30_000

export function NotificationBell({ placement }: { placement: "board" | "page" }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const inbox = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: api.notifications,
    refetchInterval: CHECK_EVERY,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
  const markAll = useMutation({ mutationFn: api.markAllNotificationsRead, onSuccess: refresh })
  const markOne = useMutation({ mutationFn: api.markNotificationRead, onSuccess: refresh })

  const unread = inbox.data?.unread ?? 0
  const list = inbox.data?.notifications ?? []

  function openOne(n: NotificationView) {
    if (!n.read) markOne.mutate(n.id)
    setOpen(false)
    void navigate({
      to: "/b/$boardId",
      params: { boardId: n.board.id },
      search: { thread: n.threadId },
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
            className={cn(
              "relative flex size-10 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground",
              placement === "board" ? "bg-surface shadow-panel" : "hover:bg-accent",
            )}
          />
        }
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="type-label absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="flex w-[360px] max-w-[calc(100vw-24px)] flex-col">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
          <PopoverTitle>Notifications</PopoverTitle>
          <Button
            variant="ghost"
            size="xs"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            Mark all read
          </Button>
        </div>
        {list.length === 0 ? (
          <p className="px-3 py-8 text-center text-muted-foreground">
            {inbox.isPending ? "Loading…" : "You're all caught up"}
          </p>
        ) : (
          <ul className="flex max-h-[420px] flex-col overflow-y-auto p-1">
            {list.map((n) => {
              const who = n.actor?.name ?? "Someone"
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openOne(n)}
                    className="flex w-full gap-2.5 rounded-lg px-2 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
                  >
                    <span
                      aria-hidden
                      className="type-label flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] text-white"
                      style={n.actor ? { background: presenceColor(n.actor.id) } : undefined}
                    >
                      {n.actor ? initials(who) : ""}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate">
                        <span className="type-body-strong">{who}</span>{" "}
                        {n.kind === "mention" ? "mentioned you" : "replied"}
                      </span>
                      <span className="truncate text-muted-foreground">{n.excerpt}</span>
                      <span className="type-caption truncate text-muted-foreground">
                        {n.board.title} · {timeAgo(n.createdAt)}
                      </span>
                    </span>
                    {!n.read && (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
                        <span className="sr-only">Unread</span>
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
