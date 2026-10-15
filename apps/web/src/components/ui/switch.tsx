import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { cn } from "cn"

/** An on/off switch (DESIGN.md → Components): `primary` track when on, `input` when off. */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-input p-0.5 outline-none transition-colors duration-(--duration-press) ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block size-4 rounded-full bg-white shadow-sm transition-transform duration-(--duration-press) ease-out data-checked:translate-x-4"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
