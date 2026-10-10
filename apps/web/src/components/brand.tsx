import { cn } from "@/lib/utils"

/** Placeholder mark until the logo is designed (DESIGN.md Known Gaps). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-5", className)}>
      <rect x="4" y="4" width="17" height="17" rx="4" className="fill-primary" />
      <rect x="11" y="11" width="17" height="17" rx="4" className="fill-primary opacity-45" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      <BrandMark />
      <span className="type-heading">Syncanvas</span>
    </span>
  )
}
