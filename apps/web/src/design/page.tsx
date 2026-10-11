import { PALETTE_COLORS } from "@syncanvas/board-model"
import { paletteShades } from "@syncanvas/renderer"
import {
  ChevronDown,
  Circle,
  CloudOff,
  Ellipsis,
  Eye,
  Image,
  Loader2,
  Lock,
  MessageCircle,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Redo2,
  Spline,
  Square,
  StickyNote,
  Type,
  Undo2,
} from "lucide-react"
import { BrandMark, Wordmark } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  setThemePreference,
  type ThemePreference,
  useResolvedTheme,
  useThemePreference,
} from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Components } from "./components"
import {
  CanvasColors,
  CanvasSample,
  Colors,
  MotionAndIcons,
  Section,
  SpaceRadiusElevation,
  Typography,
} from "./foundations"

// /design: the living reference for DESIGN.md (development builds only). Layout follows the
// shadcn skill's design-system-page outline: foundations, components, rules, recipes.

const SECTIONS = [
  ["colors", "Colors"],
  ["canvas-colors", "Canvas colors"],
  ["typography", "Type"],
  ["space", "Space"],
  ["motion", "Motion"],
  ["canvas", "Canvas"],
  ["components", "Components"],
  ["rules", "Do / Don't"],
  ["recipes", "Recipes"],
] as const

const PANEL = "bg-surface shadow-panel"

export function DesignSystemPage() {
  const preference = useThemePreference()
  return (
    <TooltipProvider delay={300}>
      <div className="min-h-svh">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-b bg-background/90 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <Wordmark />
            <span className="type-caption rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
              Design system · themed from DESIGN.md
            </span>
          </div>
          <nav className="type-label flex flex-wrap gap-3 text-muted-foreground">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="hover:text-foreground">
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex rounded-lg bg-muted p-0.5">
            {(["system", "light", "dark"] as ThemePreference[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setThemePreference(p)}
                className={cn(
                  "type-label h-7 rounded-md px-3 capitalize",
                  preference === p ? "bg-surface shadow-panel" : "text-muted-foreground",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </header>

        <main className="mx-auto flex max-w-6xl flex-col gap-16 px-4 py-10 md:px-8">
          <section className="flex flex-col gap-3">
            <h1 className="type-display">Calm, minimal, warm, precise.</h1>
            <p className="max-w-2xl text-muted-foreground">
              Quiet chrome in warm grays, one warm-indigo accent for action, selection, and focus,
              and an edge-to-edge canvas whose content provides the color.
            </p>
          </section>
          <Colors />
          <CanvasColors />
          <Typography />
          <SpaceRadiusElevation />
          <MotionAndIcons />
          <CanvasSample />
          <Components />
          <Rules />
          <Recipes />
        </main>
      </div>
    </TooltipProvider>
  )
}

function Pair({ rule, good, bad }: { rule: string; good: React.ReactNode; bad: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="type-body-strong">{rule}</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2 rounded-xl border p-4">
          <span className="type-label text-success">Do</span>
          {good}
        </div>
        <div className="flex flex-col gap-2 rounded-xl border p-4">
          <span className="type-label text-destructive">Don't</span>
          {bad}
        </div>
      </div>
    </div>
  )
}

function Rules() {
  return (
    <Section
      id="rules"
      title="Do and Don't"
      description="The DESIGN.md rules that are easiest to break."
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Pair
          rule="One primary button per view."
          good={
            <div className="flex flex-wrap gap-2">
              <Button>Share</Button>
              <Button variant="outline">Copy link</Button>
            </div>
          }
          bad={
            <div className="flex flex-wrap gap-2">
              <Button>Share</Button>
              <Button>Copy link</Button>
            </div>
          }
        />
        <Pair
          rule="Elements store a Palette color name, never a hex value."
          good={<code className="type-mono">color: "blue"</code>}
          bad={<code className="type-mono">color: "#2A64DB"</code>}
        />
        <Pair
          rule="Sentence case, no exclamation marks, say what to do next."
          good={<p>We couldn't load your boards. Check your connection and try again.</p>}
          bad={<p>Oops! Something Went Wrong!</p>}
        />
        <Pair
          rule="Use the type-* utilities, not ad-hoc sizes."
          good={<p className="type-caption">Edited 12 minutes ago</p>}
          bad={<p className="text-[13px] leading-[17px]">Edited 12 minutes ago</p>}
        />
      </div>
    </Section>
  )
}

const TOOLS = [
  MousePointer2,
  Pencil,
  Square,
  Circle,
  MoveUpRight,
  Spline,
  Type,
  StickyNote,
  Image,
  MessageCircle,
]

function Recipes() {
  const theme = useResolvedTheme()
  return (
    <Section
      id="recipes"
      title="Recipes"
      description="The DESIGN.md component recipes, rebuilt from tokens: the Board chrome (Dock tray layout) and the dashboard tile."
    >
      <div className="dot-grid flex flex-col items-center gap-8 rounded-xl p-8">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <span className={cn(PANEL, "flex h-10 items-center gap-2 rounded-full pr-4 pl-3")}>
            <BrandMark className="size-5" />
            <span className="type-body-strong">Q4 product retro</span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </span>
          <span className={cn(PANEL, "flex h-10 items-center gap-2 rounded-full pr-4 pl-3")}>
            <BrandMark className="size-5" />
            <span className="type-body-strong">Q4 product retro</span>
            <span className="type-label flex items-center gap-1 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Connecting…
            </span>
          </span>
          <span
            className={cn(
              PANEL,
              "flex h-10 items-center gap-2 rounded-full pr-4 pl-3 ring-1 ring-warning",
            )}
          >
            <BrandMark className="size-5" />
            <span className="type-body-strong">Q4 product retro</span>
            <span className="type-label flex items-center gap-1 text-warning">
              <CloudOff className="size-3.5" /> Offline
            </span>
          </span>
          <span className={cn(PANEL, "flex h-10 items-center gap-2 rounded-full pr-4 pl-3")}>
            <BrandMark className="size-5" />
            <span className="type-body-strong">Q4 product retro</span>
            <span className="type-label flex items-center gap-1 text-muted-foreground">
              <Eye className="size-3.5" /> View only
            </span>
          </span>
        </div>

        <div className={cn(PANEL, "flex flex-col overflow-hidden rounded-xl")}>
          <div className="flex items-center gap-1 border-b bg-muted/50 px-2 py-1.5">
            {PALETTE_COLORS.map((color) => {
              const shades = paletteShades(color, theme)
              return (
                <span
                  key={color}
                  className={cn(
                    "size-6 rounded-full border-2",
                    color === "blue" && "ring-2 ring-primary ring-offset-2 ring-offset-muted",
                  )}
                  style={{ background: shades.fill, borderColor: shades.stroke }}
                />
              )
            })}
            <span className="mx-1.5 h-5 w-px bg-border" />
            <Button variant="ghost" size="icon-sm" aria-label="Lock" disabled>
              <Lock />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="More" disabled>
              <Ellipsis />
            </Button>
          </div>
          <div className="flex items-center justify-center gap-0.5 p-1">
            {TOOLS.map((Icon, i) => (
              <Button
                // biome-ignore lint/suspicious/noArrayIndexKey: static recipe
                key={i}
                variant="ghost"
                size="icon-sm"
                className={cn(i === 0 && "bg-primary-subtle text-primary hover:bg-primary-subtle")}
              >
                <Icon className="size-5" />
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-8">
          <span className={cn(PANEL, "flex items-center gap-0.5 rounded-full p-1")}>
            <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Undo">
              <Undo2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label="Redo"
              disabled
            >
              <Redo2 />
            </Button>
            <span className="mx-0.5 h-5 w-px bg-border" />
            <span className="type-mono flex items-center gap-0.5 px-2.5">
              100% <ChevronDown className="size-3.5" />
            </span>
          </span>
          <span className="relative">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                d="M2 2 L16 8 L9.5 9.5 L7 16 Z"
                fill="#1D4ED8"
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="type-label absolute top-4 left-3 rounded-full px-1.5 py-0.5 whitespace-nowrap text-white"
              style={{ background: "#1D4ED8" }}
            >
              Amara Okafor
            </span>
          </span>
          <span
            className={cn(
              PANEL,
              "type-label flex size-7 items-center justify-center rounded-full rounded-bl-none",
            )}
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-[#15803D] text-[10px] text-white">
              2
            </span>
          </span>
          <span className="type-label flex size-7 items-center justify-center rounded-full rounded-bl-none border border-dashed border-muted-foreground bg-surface opacity-50">
            <span className="flex size-5 items-center justify-center rounded-full bg-[#C2410C] text-[10px] text-white">
              DR
            </span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Q4 product retro", "Edited just now"],
          [
            "Customer journey map for the enterprise onboarding flow (v3)",
            "Amara Okafor · Edited yesterday",
          ],
        ].map(([title, meta]) => (
          <div
            key={title}
            className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-surface"
          >
            <div className="dot-grid flex aspect-[16/10] items-center justify-center border-b">
              <BrandMark className="size-6 opacity-30 grayscale" />
            </div>
            <div className="flex flex-col p-3">
              <span className="type-body-strong truncate">{title}</span>
              <span className="type-caption truncate text-muted-foreground">{meta}</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
