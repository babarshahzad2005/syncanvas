import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[transform,background-color,color,border-color] duration-(--duration-press) ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-active",
        outline: "border-border bg-surface text-foreground hover:bg-muted aria-expanded:bg-muted",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // DESIGN.md control-height: 36px default, 44px on touch (pointer: coarse).
      size: {
        default:
          "h-9 gap-1.5 px-3 pointer-coarse:h-11 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-7 gap-1 rounded-md px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1 rounded-md px-2.5 pointer-coarse:h-11 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 gap-2 px-4 pointer-coarse:h-11 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9 pointer-coarse:size-11 [&_svg:not([class*='size-'])]:size-5",
        "icon-xs": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8 rounded-md pointer-coarse:size-11",
        "icon-lg": "size-10 pointer-coarse:size-11 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
