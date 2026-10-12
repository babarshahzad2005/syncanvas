import { cn } from "@/lib/utils"

/** A key, per DESIGN.md `kbd`: mono 11px on `muted`, `sm` corners. */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "type-mono inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-muted px-1 text-[11px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}
