import { Link } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"
import { BrandMark } from "@/components/brand"

/** Board screen. The canvas and the Dock tray chrome arrive in M0 tickets 07–08. */
export function BoardScreen() {
  return (
    <div className="dot-grid fixed inset-0 overflow-hidden">
      <Link
        to="/"
        className="fixed top-3 left-3 flex h-10 items-center gap-2 rounded-full bg-surface pr-4 pl-3 shadow-panel"
      >
        <BrandMark className="size-5" />
        <ChevronLeft className="size-4 text-muted-foreground" />
        <span className="type-body-strong">Boards</span>
      </Link>
    </div>
  )
}
