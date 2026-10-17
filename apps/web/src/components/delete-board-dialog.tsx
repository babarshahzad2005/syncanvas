import { TRASH_DAYS } from "@syncanvas/shared"
import { ConfirmDialog } from "@/components/confirm-dialog"

/** The Owner confirms sending a Board to Trash, from its tile or the Board menu (M5a). */
export function DeleteBoardDialog({
  title,
  open,
  onOpenChange,
  pending,
  onConfirm,
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onConfirm: () => void
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete “${title}”?`}
      description={`Everyone it's shared with loses access right away. It stays in your Trash for ${TRASH_DAYS} days, so you can restore it.`}
      confirmLabel="Delete board"
      pending={pending}
      onConfirm={onConfirm}
    />
  )
}
