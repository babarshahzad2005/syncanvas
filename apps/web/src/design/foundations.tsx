import { addRect, listElements, PALETTE_COLORS } from "@syncanvas/board-model"
import { drawScene, paletteShades, type Theme } from "@syncanvas/renderer"
import { MousePointer2, Square, StickyNote } from "lucide-react"
import { useEffect, useRef } from "react"
import * as Y from "yjs"
import { useResolvedTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { ColorPair } from "./color-pair"
import {
  CANVAS_BG,
  contrast,
  MOTION,
  PRESENCE,
  RADII,
  SPACING,
  STICKY,
  STICKY_TEXT,
  TYPE_SCALE,
} from "./tokens"

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="type-title">{title}</h2>
        {description && <p className="max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Ratio({ value, needs }: { value: number; needs: number }) {
  const ok = value >= needs
  return (
    <span
      className={cn("type-mono", ok ? "text-muted-foreground" : "font-semibold text-destructive")}
    >
      {value.toFixed(2)}
      {ok ? "" : ` < ${needs}`}
    </span>
  )
}

const ROLE_PAIRS = [
  ["Page", "background", "foreground"],
  ["Card / surface", "card", "card-foreground"],
  ["Popover", "popover", "popover-foreground"],
  ["Primary action", "primary", "primary-foreground"],
  ["Secondary", "secondary", "secondary-foreground"],
  ["Muted text on muted band", "muted", "muted-foreground"],
  ["Muted text on page", "background", "muted-foreground"],
  ["Muted text on surface", "surface", "muted-foreground"],
  ["Accent (hover wash)", "accent", "accent-foreground"],
  ["Destructive on page", "background", "destructive"],
  ["Destructive button", "destructive", "destructive-foreground"],
  ["Link / primary on surface", "surface", "primary"],
  ["Active tool", "primary-subtle", "primary"],
  ["Warning text (Offline)", "surface", "warning"],
  ["Success text", "background", "success"],
] as const

const SWATCHES = [
  "background",
  "surface",
  "popover",
  "muted",
  "accent",
  "border",
  "input",
  "ring",
  "primary",
  "primary-active",
  "primary-subtle",
  "destructive",
  "success",
  "warning",
  "grid-dot",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const

export function Colors() {
  return (
    <Section
      id="colors"
      title="Color roles"
      description="Each role as its surface and foreground, with the contrast measured live in the current theme. Text needs at least 4.5:1."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ROLE_PAIRS.map(([name, bg, fg]) => (
          <ColorPair key={name} name={name} background={bg} foreground={fg} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {SWATCHES.map((token) => (
          <div key={token} className="flex items-center gap-2">
            <span
              className="size-8 shrink-0 rounded-md border"
              style={{ background: `var(--${token})` }}
            />
            <span className="type-mono truncate text-muted-foreground">{token}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

export function CanvasColors() {
  const theme = useResolvedTheme()
  const canvas = CANVAS_BG[theme]
  return (
    <Section
      id="canvas-colors"
      title="Palette, sticky, and presence colors"
      description="Elements store a Palette color name; each theme maps it to its own shades. Strokes need 3:1 against the canvas. Shown for the current theme."
    >
      <div className="flex flex-col gap-2">
        <h3 className="type-heading">Palette colors (stroke vs canvas)</h3>
        <div
          className="grid grid-cols-2 gap-3 rounded-xl p-4 sm:grid-cols-5"
          style={{ background: canvas }}
        >
          {PALETTE_COLORS.map((color) => {
            const shades = paletteShades(color, theme)
            return (
              <div key={color} className="flex flex-col gap-2">
                <div
                  className="h-14 rounded-[4px] border-2"
                  style={{ background: shades.fill, borderColor: shades.stroke }}
                />
                <div className="flex items-baseline justify-between">
                  <span
                    className="type-label"
                    style={{ color: theme === "dark" ? "#EDEBE7" : "#1C1B19" }}
                  >
                    {color}
                  </span>
                  <Ratio value={contrast(shades.stroke, canvas)} needs={3} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="type-heading">Sticky notes (ink text on each)</h3>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {Object.entries(STICKY).map(([name, [light, dark]]) => {
            const bg = theme === "dark" ? dark : light
            return (
              <div key={name} className="flex flex-col gap-1">
                <div
                  className="flex aspect-square items-start p-2 text-sm font-medium shadow-sm"
                  style={{ background: bg, color: STICKY_TEXT }}
                >
                  {name}
                </div>
                <Ratio value={contrast(STICKY_TEXT, bg)} needs={4.5} />
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="type-heading">Presence colors (white cursor labels)</h3>
        <div className="flex flex-wrap gap-3 rounded-xl p-4" style={{ background: canvas }}>
          {PRESENCE.map(([name, color]) => (
            <div key={name} className="flex flex-col items-start gap-1">
              <span
                className="type-label rounded-full px-1.5 py-0.5 text-white"
                style={{ background: color }}
              >
                {name}
              </span>
              <Ratio value={contrast("#FFFFFF", color)} needs={4.5} />
            </div>
          ))}
        </div>
      </div>
    </Section>
  )
}

export function Typography() {
  return (
    <Section
      id="typography"
      title="Typography"
      description="Geist Sans for everything; Geist Mono only for shortcuts and numbers. Use the type-* utilities, never ad-hoc sizes."
    >
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left">
          <thead className="type-label border-b bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Token</th>
              <th className="px-4 py-2">Spec</th>
              <th className="px-4 py-2">Use</th>
              <th className="px-4 py-2">Specimen</th>
            </tr>
          </thead>
          <tbody>
            {TYPE_SCALE.map(([token, spec, use, sample]) => (
              <tr key={token} className="border-b last:border-b-0">
                <td className="type-mono px-4 py-3 whitespace-nowrap">{token}</td>
                <td className="type-caption px-4 py-3 whitespace-nowrap text-muted-foreground">
                  {spec}
                </td>
                <td className="type-caption px-4 py-3 text-muted-foreground">{use}</td>
                <td className={cn("max-w-md truncate px-4 py-3", token)}>{sample}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="max-w-2xl">
        Syncanvas keeps the chrome quiet so the Board's content provides the color. Read the{" "}
        <a className="text-primary underline-offset-4 hover:underline" href="#colors">
          color roles
        </a>{" "}
        before adding a new surface, and press{" "}
        <code className="type-mono rounded-sm bg-muted px-1">Shift 1</code> on a Board to zoom to
        fit.
      </p>
    </Section>
  )
}

export function SpaceRadiusElevation() {
  return (
    <Section
      id="space"
      title="Spacing, radius, elevation"
      description="A 4px base. Nested corners shrink inward."
    >
      <div className="flex flex-col gap-1.5">
        {SPACING.map((px) => (
          <div key={px} className="flex items-center gap-3">
            <span className="type-mono w-10 text-right text-muted-foreground">{px}</span>
            <span className="h-3 rounded-sm bg-primary/70" style={{ width: Math.max(px, 1) * 4 }} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {RADII.map(([cls, px, use]) => (
          <div key={cls} className="flex flex-col gap-2">
            <div className={cn("h-16 border-2 border-primary bg-primary-subtle", cls)} />
            <span className="type-label">
              {cls} · {px === 9999 ? "pill" : `${px}px`}
            </span>
            <span className="type-caption text-muted-foreground">{use}</span>
          </div>
        ))}
      </div>
      <div className="dot-grid grid grid-cols-1 gap-6 rounded-xl p-6 sm:grid-cols-3">
        {[
          ["shadow-panel", "Panel", "Dock, title pill, floating chrome"],
          ["shadow-popover", "Popover", "Menus, tooltips, popovers"],
          ["shadow-dialog", "Dialog", "Dialogs"],
        ].map(([cls, name, use]) => (
          <div key={cls} className={cn("flex flex-col gap-1 rounded-xl bg-surface p-4", cls)}>
            <span className="type-heading">{name}</span>
            <span className="type-caption text-muted-foreground">{use}</span>
            <span className="type-mono text-muted-foreground">{cls}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

export function MotionAndIcons() {
  return (
    <Section
      id="motion"
      title="Motion and icons"
      description="Motion confirms what you did and never slows you down. Only transform and opacity animate. Never ease-in."
    >
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left">
          <tbody>
            {MOTION.map(([token, value, use]) => (
              <tr key={token} className="border-b last:border-b-0">
                <td className="type-mono px-4 py-2 whitespace-nowrap">{token}</td>
                <td className="type-mono px-4 py-2 whitespace-nowrap text-muted-foreground">
                  {value}
                </td>
                <td className="type-caption px-4 py-2 text-muted-foreground">{use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-6">
        {[16, 20].map((size) =>
          [
            ["text-foreground", "foreground"],
            ["text-muted-foreground", "muted"],
          ].map(([cls, label]) => (
            <div key={`${size}${label}`} className={cn("flex items-center gap-2", cls)}>
              <MousePointer2 style={{ width: size, height: size }} />
              <Square style={{ width: size, height: size }} />
              <StickyNote style={{ width: size, height: size }} />
              <span className="type-mono">
                {size}px · {label}
              </span>
            </div>
          )),
        )}
      </div>
    </Section>
  )
}

/** The real renderer drawing sample Elements, at 100% and at 37.5% (grid doubled and fading). */
export function CanvasSample() {
  const theme = useResolvedTheme()
  return (
    <Section
      id="canvas"
      title="Canvas"
      description="Drawn by the same renderer as the Board: dot grid, Palette colors, and the selection outline with constant-size handles."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RendererPreview theme={theme} zoom={1} label="100% zoom" />
        <RendererPreview theme={theme} zoom={0.375} label="37.5%: grid spacing doubles and fades" />
      </div>
    </Section>
  )
}

function RendererPreview({ theme, zoom, label }: { theme: Theme; zoom: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const doc = new Y.Doc()
    const ids = ["blue", "green", "pink"].map((color, i) =>
      addRect(
        doc,
        {
          position: { x: 40 + i * 140, y: 50 + (i % 2) * 40 },
          size: { w: 110, h: 80 },
          color: color as "blue",
        },
        "sample",
      ),
    )
    const dpr = window.devicePixelRatio || 1
    const box = canvas.getBoundingClientRect()
    canvas.width = box.width * dpr
    canvas.height = box.height * dpr
    drawScene(ctx, {
      elements: listElements(doc),
      camera: { x: 20, y: 20, zoom },
      theme,
      size: { w: box.width, h: box.height },
      dpr,
      selection: new Set([ids[2] ?? ""]),
    })
    doc.destroy()
  }, [theme, zoom])
  return (
    <figure className="flex flex-col gap-2">
      <canvas ref={ref} className="h-56 w-full rounded-xl border" />
      <figcaption className="type-caption text-muted-foreground">{label}</figcaption>
    </figure>
  )
}
