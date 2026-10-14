import { toast } from "sonner"

// A toast that should appear on the page you're about to land on, e.g. the dashboard after
// losing access to a Board (M3 ticket 02). That page's Toaster isn't mounted yet, so the
// message waits here until it is.

let pending: { title: string; description?: string } | null = null

export function toastOnNextPage(title: string, description?: string) {
  pending = { title, description }
}

/** Shows the waiting toast, if any; called once the next page's Toaster is mounted. */
export function showPendingToast() {
  if (!pending) return
  const { title, description } = pending
  pending = null
  // After the Toaster's own mount effect has subscribed.
  setTimeout(() => toast(title, description ? { description } : undefined), 0)
}
