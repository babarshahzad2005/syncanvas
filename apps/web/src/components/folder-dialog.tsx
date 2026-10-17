import { FOLDER_NAME_MAX, normalizeFolderName } from "@syncanvas/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api, queryKeys } from "@/lib/api"

// Naming a Folder (M5a ticket 02): a new one from the dashboard's "New folder", or an existing
// one from its ⋯ menu.

export function FolderDialog({
  folder,
  open,
  onOpenChange,
}: {
  /** The Folder being renamed; none for a new one. */
  folder?: { id: string; name: string }
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)]">
        {open && <FolderForm folder={folder} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function FolderForm({
  folder,
  onDone,
}: {
  folder?: { id: string; name: string }
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(folder?.name ?? "")
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (name: string) =>
      folder ? api.renameFolder(folder.id, name) : api.createFolder(name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
      onDone()
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Couldn't save it. Check your connection."),
  })
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const name = normalizeFolderName(value)
        if (!name) return setError(`Folder names are 1–${FOLDER_NAME_MAX} characters.`)
        save.mutate(name)
      }}
    >
      <DialogTitle>{folder ? "Rename folder" : "New folder"}</DialogTitle>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="folder-name">Name</Label>
        <Input
          id="folder-name"
          value={value}
          maxLength={FOLDER_NAME_MAX}
          placeholder="Product, Retros, Design reviews…"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "folder-name-error" : undefined}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          autoFocus
        />
        {error && (
          <p id="folder-name-error" role="alert" className="type-caption text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {folder ? "Save" : "Create folder"}
        </Button>
      </div>
    </form>
  )
}
