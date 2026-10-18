import { DIGEST_GAP_HOURS } from "@syncanvas/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { errorMessage } from "@/board/share-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { api, queryKeys } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { clearAllLocalCopies } from "@/sync/local-copy"

// Settings (DESIGN.md → Dashboard → Settings; M5a ticket 06): Notifications, with the digest
// switch from M4 ticket 04, and Account, with "Delete account…".

export function SettingsDialog({
  userId,
  open,
  onOpenChange,
}: {
  userId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [deleting, setDeleting] = useState(false)
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] gap-6">
          <DialogTitle>Settings</DialogTitle>
          <section aria-labelledby="settings-notifications" className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <h3 id="settings-notifications" className="type-label text-muted-foreground">
                Notifications
              </h3>
              <DialogDescription>
                Mentions and replies always show under the bell.
              </DialogDescription>
            </div>
            <DigestSwitch open={open} />
          </section>
          <section aria-labelledby="settings-account" className="flex flex-col gap-3 border-t pt-6">
            <h3 id="settings-account" className="type-label text-muted-foreground">
              Account
            </h3>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <span className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
                <span className="type-body-strong">Delete account</span>
                <span className="type-caption text-muted-foreground">
                  Deletes the boards you own and signs you out. This can't be undone.
                </span>
              </span>
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => setDeleting(true)}
              >
                Delete account…
              </Button>
            </div>
          </section>
        </DialogContent>
      </Dialog>
      <DeleteAccountDialog userId={userId} open={deleting} onOpenChange={setDeleting} />
    </>
  )
}

function DigestSwitch({ open }: { open: boolean }) {
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
  )
}

/** "3 boards you own will be deleted for everyone." Trash counts: those go too. */
function ownedSentence(count: number) {
  if (count === 0) return ""
  return `${count === 1 ? "1 board" : `${count} boards`} you own will be deleted for everyone. `
}

function DeleteAccountDialog({
  userId,
  open,
  onOpenChange,
}: {
  userId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [typed, setTyped] = useState("")
  const dashboard = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: api.dashboard,
    enabled: open,
  })
  const owned =
    (dashboard.data?.boards.filter((b) => b.owner.id === userId).length ?? 0) +
    (dashboard.data?.trash.length ?? 0)
  const remove = useMutation({
    mutationFn: () => api.deleteAccount(),
    onSuccess: async () => {
      // Nothing of this account stays on the device.
      await clearAllLocalCopies()
      await authClient.signOut().catch(() => {})
      // A full load, so no cached data outlives the account.
      window.location.assign("/sign-in?deleted=1")
    },
    onError: (e) => toast(errorMessage(e)),
  })
  const close = (next: boolean) => {
    if (remove.isPending) return
    if (!next) setTyped("")
    onOpenChange(next)
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent showCloseButton={false} className="grid-cols-[minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            {dashboard.isSuccess ? ownedSentence(owned) : ""}
            Your memberships, folders, favorites, and notifications go too. Comments you left on
            other boards stay, shown as “Deleted user”.
          </DialogDescription>
        </div>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (typed === "DELETE") remove.mutate()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-delete">Type DELETE to confirm</Label>
            <Input
              id="confirm-delete"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => close(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={typed !== "DELETE" || remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Delete account"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
