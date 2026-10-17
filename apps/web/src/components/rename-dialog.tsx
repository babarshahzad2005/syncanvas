import { BOARD_TITLE_MAX, normalizeBoardTitle } from "@syncanvas/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api, queryKeys } from "@/lib/api"

// Renaming a Board (M5a ticket 01): from the Board menu or a dashboard tile's ⋯. The Owner and
// Editors can; the server checks, and open Boards get the new title live.

export function RenameDialog({
  boardId,
  title,
  open,
  onOpenChange,
  onRenamed,
}: {
  boardId: string
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRenamed?: (title: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)]">
        {open && (
          <RenameForm
            boardId={boardId}
            title={title}
            onDone={(next) => {
              onRenamed?.(next)
              onOpenChange(false)
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RenameForm({
  boardId,
  title,
  onDone,
  onCancel,
}: {
  boardId: string
  title: string
  onDone: (title: string) => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState(title)
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (next: string) => api.renameBoard(boardId, next),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
      onDone(res.title)
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Couldn't rename it. Check your connection."),
  })
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const next = normalizeBoardTitle(value)
        if (!next) return setError(`Titles are 1–${BOARD_TITLE_MAX} characters.`)
        if (next === title) return onDone(title)
        save.mutate(next)
      }}
    >
      <DialogTitle>Rename board</DialogTitle>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="board-title">Title</Label>
        <Input
          id="board-title"
          value={value}
          maxLength={BOARD_TITLE_MAX}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "board-title-error" : undefined}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          onFocus={(e) => e.currentTarget.select()}
          autoFocus
        />
        {error && (
          <p id="board-title-error" role="alert" className="type-caption text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  )
}
