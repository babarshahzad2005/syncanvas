import { DISPLAY_NAME_MAX, displayNameOf, normalizeDisplayName } from "@syncanvas/shared"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth-client"

// The display name others see on cursors and in the presence list (M2 ticket 01; DESIGN.md
// → Display name). Asked once, the first time a User without a name opens a Board ("first"),
// and from the account menu's "Display name…" ("edit"). Skipping saves the prefill, so the
// question never comes back.

type Props = {
  user: { name?: string | null; email: string }
  mode: "first" | "edit"
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NameDialog({ user, mode, open, onOpenChange }: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Dismissing the first-time question (Escape, a click outside) counts as skipping.
        if (!next && mode === "first") {
          void authClient.updateUser({ name: displayNameOf(user) }).then(() => onOpenChange(false))
        } else onOpenChange(next)
      }}
    >
      <DialogContent showCloseButton={mode === "edit"}>
        {/* Remounted per opening, so the field starts from the current name each time. */}
        {open && <NameForm user={user} mode={mode} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function NameForm({
  user,
  mode,
  onDone,
}: {
  user: Props["user"]
  mode: Props["mode"]
  onDone: () => void
}) {
  const prefill = displayNameOf(user)
  const [value, setValue] = useState(prefill)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(name: string) {
    const normalized = normalizeDisplayName(name)
    if (!normalized) {
      setError(`Names are 1–${DISPLAY_NAME_MAX} characters.`)
      return
    }
    setSaving(true)
    setError(null)
    // Better Auth's update-user route; the server checks the name the same way, and the
    // session (and everything showing the name) refreshes by itself.
    const { error: failed } = await authClient.updateUser({ name: normalized })
    setSaving(false)
    if (failed) setError(failed.message ?? "Couldn't save your name. Try again.")
    else onDone()
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save(value)
      }}
    >
      <div className="flex flex-col gap-1.5">
        <DialogTitle>{mode === "first" ? "What should others see?" : "Display name"}</DialogTitle>
        <DialogDescription>
          Your name shows on your cursor and in the list of people on a Board.
        </DialogDescription>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="display-name">Name</Label>
        <Input
          id="display-name"
          value={value}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="name"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "display-name-error" : undefined}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        {error && (
          <p id="display-name-error" role="alert" className="type-caption text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        {mode === "first" ? (
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => void save(prefill)}
          >
            Skip for now
          </Button>
        ) : (
          <Button type="button" variant="ghost" disabled={saving} onClick={onDone}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={saving}>
          Save
        </Button>
      </div>
    </form>
  )
}
