import { ChevronDown, Loader2, Plus, Share2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Section } from "./foundations"
import { previewState, StateMatrix } from "./state-matrix"

function Block({
  title,
  when,
  children,
}: {
  title: string
  when: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border p-5">
      <div className="flex flex-col gap-0.5">
        <h3 className="type-heading">{title}</h3>
        <p className="type-caption text-muted-foreground">{when}</p>
      </div>
      {children}
    </div>
  )
}

const BUTTON_VARIANTS = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const

export function Components() {
  return (
    <Section
      id="components"
      title="Components"
      description="shadcn on Base UI, nova style, restyled to DESIGN.md. States are pinned side by side so nothing needs hovering."
    >
      <Block
        title="Button"
        when="Actions. One primary (default) per view; outline for secondary actions; ghost inside toolbars."
      >
        <StateMatrix
          rows={BUTTON_VARIANTS}
          states={["default", "hover", "focus", "active", "disabled", "loading"]}
          render={(variant, state) =>
            state === "loading" ? (
              <Button variant={variant} disabled>
                <Loader2 data-icon="inline-start" className="animate-spin" /> Saving…
              </Button>
            ) : (
              <Button variant={variant} {...previewState(state)}>
                Save board
              </Button>
            )
          }
        />
        <div className="flex flex-wrap items-center gap-3">
          {(["xs", "sm", "default", "lg"] as const).map((size) => (
            <Button key={size} size={size} variant="outline">
              {size}
            </Button>
          ))}
          <span className="type-caption text-muted-foreground">36px default, 44px on touch</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button>
            <Plus data-icon="inline-start" /> New board
          </Button>
          <Button variant="outline">
            Theme <ChevronDown data-icon="inline-end" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Share">
            <Share2 />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Delete">
            <Trash2 />
          </Button>
          <Button className="max-w-48">
            <span className="truncate">Create a board for the enterprise onboarding retro</span>
          </Button>
        </div>
      </Block>

      <Block
        title="Input + Label"
        when="Text entry. 36px, hairline border, solid 2px focus ring with offset."
      >
        <StateMatrix
          rows={["input"] as const}
          states={["default", "hover", "focus", "disabled", "invalid"]}
          render={(_, state) => (
            <Input
              placeholder="you@company.com"
              aria-invalid={state === "invalid" || undefined}
              {...previewState(state)}
            />
          )}
        />
        <div className="flex max-w-sm flex-col gap-2">
          <Label htmlFor="design-email">Email</Label>
          <Input
            id="design-email"
            type="email"
            placeholder="you@company.com"
            aria-invalid
            aria-describedby="design-email-error"
          />
          <p id="design-email-error" className="type-caption text-destructive">
            We couldn't send a sign-in link. Check the address and try again.
          </p>
        </div>
      </Block>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Block
          title="Tooltip"
          when="Names an icon button and its shortcut. After the first opens, the next ones show instantly."
        >
          <div className="flex gap-2">
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon" aria-label="Rectangle" />}
              >
                <span className="type-mono">R</span>
              </TooltipTrigger>
              <TooltipContent>
                Rectangle{" "}
                <kbd className="type-mono rounded-sm bg-background/15 px-1 text-[11px]">R</kbd>
              </TooltipContent>
            </Tooltip>
            <span className="type-caption self-center text-muted-foreground">Hover the button</span>
          </div>
        </Block>

        <Block
          title="Dropdown menu"
          when="Account and zoom menus. Popover elevation, 12px radius, 32px items."
        >
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="w-fit" />}>
              Open menu <ChevronDown data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>ada@example.com</DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Zoom to fit</DropdownMenuItem>
              <DropdownMenuItem disabled>Trash (coming soon)</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Delete board</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Block>
      </div>
    </Section>
  )
}
