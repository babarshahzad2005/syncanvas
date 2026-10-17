import { DIGEST_GAP_HOURS } from "@syncanvas/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { api, queryKeys } from "@/lib/api"

// Notifications settings (DESIGN.md → Notifications settings; M4 ticket 04): one switch for
// the digest emails, which every digest can also turn off with its unsubscribe link.

export function NotificationSettings({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const settings = useQuery({
    queryKey: queryKeys.settings,
    queryFn: api.settings,
    enabled: open,
    refetchOnMount: "always",
  })
  const save = useMutation({
    mutationFn: (digestEnabled: boolean) => api.saveSettings({ digestEnabled }),
    onSuccess: (saved) => queryClient.setQueryData(queryKeys.settings, saved),
    onError: () => toast("Couldn't save that. Check your connection."),
  })
  const on = save.isPending ? save.variables : settings.data?.digestEnabled

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5 pr-8">
          <DialogTitle>Notifications</DialogTitle>
          <DialogDescription>Mentions and replies always show under the bell.</DialogDescription>
        </div>
        <div className="flex items-start justify-between gap-4">
          <span className="flex flex-col gap-0.5">
            <span id="digest-label" className="type-body-strong">
              Email me about unread notifications
            </span>
            <span className="type-caption text-muted-foreground">
              A digest at most every {DIGEST_GAP_HOURS} hours, only for what you haven't read.
            </span>
          </span>
          {on === undefined ? (
            // Loading: a placeholder, so the switch never shows a state it isn't in.
            <span aria-hidden className="h-5 w-9 shrink-0 animate-pulse rounded-full bg-muted" />
          ) : (
            <Switch
              aria-labelledby="digest-label"
              checked={on}
              disabled={settings.isPending || save.isPending}
              onCheckedChange={(next) => save.mutate(next)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
