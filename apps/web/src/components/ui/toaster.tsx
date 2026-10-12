import { Toaster as Sonner } from "sonner"
import { useResolvedTheme } from "@/lib/theme"

/**
 * Toasts (DESIGN.md → Toasts): popover-tier panels with 2xl corners. On the Board they sit
 * bottom-center, above the dock and its style tray; elsewhere bottom-right.
 */
export function Toaster({ placement }: { placement: "board" | "page" }) {
  const theme = useResolvedTheme()
  return (
    <Sonner
      theme={theme}
      position={placement === "board" ? "bottom-center" : "bottom-right"}
      offset={placement === "board" ? { bottom: 120 } : undefined}
      mobileOffset={placement === "board" ? { bottom: 120 } : undefined}
      toastOptions={{
        classNames: {
          toast:
            "!rounded-2xl !border !border-border !bg-popover !text-popover-foreground !shadow-popover !font-sans",
          title: "type-body-strong",
          description: "type-caption !text-muted-foreground",
        },
      }}
    />
  )
}
