import {
  elementsOf,
  type Fill,
  PALETTE_COLORS,
  type PaletteColor,
  type PenWidth,
  recolorElement,
  setFill,
  setPenWidth,
} from "@syncanvas/board-model"
import { paletteShades } from "@syncanvas/renderer"
import {
  ChevronDown,
  Circle,
  Ellipsis,
  Image,
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
import { useEffect, useState, useSyncExternalStore } from "react"
import type * as Y from "yjs"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useResolvedTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import type { CanvasHandle } from "./board-canvas"
import { type Tool, useBoardUi } from "./store"

// Board chrome, "Dock tray" layout (DESIGN.md → Layout → Board screen).

const PANEL = "bg-surface shadow-panel"

const TOOLS: {
  id: Tool | null
  label: string
  shortcut?: string
  icon: typeof Square
}[] = [
  { id: "select", label: "Select", shortcut: "V", icon: MousePointer2 },
  { id: "pen", label: "Pen", shortcut: "P", icon: Pencil },
  { id: "rect", label: "Rectangle", shortcut: "R", icon: Square },
  { id: "ellipse", label: "Ellipse", shortcut: "O", icon: Circle },
  { id: null, label: "Arrow", shortcut: "A", icon: MoveUpRight },
  { id: null, label: "Connector", shortcut: "C", icon: Spline },
  { id: null, label: "Text", shortcut: "T", icon: Type },
  { id: null, label: "Sticky note", shortcut: "S", icon: StickyNote },
  { id: null, label: "Image", icon: Image },
  { id: null, label: "Comment", icon: MessageCircle },
]

/** Element types that have a fill (spec: style tray per type). */
const SHAPE_TYPES = new Set(["rect", "ellipse"])
const PEN_TYPES = new Set(["pen"])

const WIDTHS: { width: PenWidth; label: string }[] = [
  { width: "S", label: "Thin" },
  { width: "M", label: "Medium" },
  { width: "L", label: "Thick" },
]

const FILLS: { fill: Fill; label: string }[] = [
  { fill: "none", label: "No fill" },
  { fill: "light", label: "Light fill" },
  { fill: "solid", label: "Solid fill" },
]

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="type-mono rounded-sm bg-background/15 px-1 text-[11px] text-background/80">
      {children}
    </kbd>
  )
}

function Hint({
  label,
  shortcut,
  children,
}: {
  label: string
  shortcut?: string
  children: React.ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="top">
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** Bottom-center dock: the tool row, with a style tray that grows out of it for a selection. */
export function Dock({ doc, origin, canEdit }: { doc: Y.Doc; origin: object; canEdit: boolean }) {
  const tool = useBoardUi((s) => s.tool)
  const setTool = useBoardUi((s) => s.setTool)
  const selection = useBoardUi((s) => s.selection)
  const tray = !canEdit ? null : selection.size > 0 ? "selection" : tool === "pen" ? "pen" : null

  return (
    <div
      className={cn(
        PANEL,
        "fixed bottom-3 left-1/2 flex -translate-x-1/2 flex-col overflow-hidden rounded-xl",
      )}
    >
      {tray === "selection" && <SelectionTray doc={doc} origin={origin} selection={selection} />}
      {tray === "pen" && <PenToolTray />}
      <div
        role="toolbar"
        aria-label="Tools"
        className="flex items-center justify-center gap-0.5 p-1"
      >
        {TOOLS.map((t) => {
          const available = t.id === "select" || (t.id !== null && canEdit)
          return (
            <Hint
              key={t.label}
              label={available ? t.label : `${t.label} (coming soon)`}
              shortcut={t.shortcut}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t.label}
                aria-pressed={t.id !== null && tool === t.id}
                disabled={!available}
                onClick={() => t.id && setTool(t.id)}
                className={cn(
                  t.id !== null &&
                    tool === t.id &&
                    "bg-primary-subtle text-primary hover:bg-primary-subtle",
                )}
              >
                <t.icon className="size-5" />
              </Button>
            </Hint>
          )
        })}
      </div>
    </div>
  )
}

/** The tray for a selection: shows and edits what the selected Elements have. */
function SelectionTray({
  doc,
  origin,
  selection,
}: {
  doc: Y.Doc
  origin: object
  selection: ReadonlySet<string>
}) {
  // Re-read on every document change, so the marked controls follow edits (local or remote).
  // The snapshot is a string so React can compare it cheaply.
  const snapshot = useSyncExternalStore(
    (onChange) => {
      const elements = elementsOf(doc)
      elements.observeDeep(onChange)
      return () => elements.unobserveDeep(onChange)
    },
    () => {
      const elements = elementsOf(doc)
      const fields = [...selection].map((id) => elements.get(id))
      const first = fields[0]
      const all = (types: Set<string>) => fields.every((f) => types.has(f?.get("type") as string))
      return JSON.stringify([
        first?.get("color") ?? null,
        all(SHAPE_TYPES) ? (first?.get("fill") ?? "light") : null,
        all(PEN_TYPES) ? (first?.get("width") ?? null) : null,
      ])
    },
  )
  const [color, fill, width] = JSON.parse(snapshot) as [
    PaletteColor | null,
    Fill | null,
    PenWidth | null,
  ]
  return (
    <TrayControls
      color={color}
      fill={fill}
      width={width}
      onColor={(value) => {
        for (const id of selection) recolorElement(doc, id, value, origin)
      }}
      onFill={(value) => {
        for (const id of selection) setFill(doc, id, value, origin)
      }}
      onWidth={(value) => {
        for (const id of selection) setPenWidth(doc, id, value, origin)
      }}
    />
  )
}

/** The tray while the pen tool is active: the color and width of the next strokes. */
function PenToolTray() {
  const pen = useBoardUi((s) => s.pen)
  const setPen = useBoardUi((s) => s.setPen)
  return (
    <TrayControls
      color={pen.color}
      fill={null}
      width={pen.width}
      onColor={(color) => setPen({ ...pen, color })}
      onFill={() => {}}
      onWidth={(width) => setPen({ ...pen, width })}
    />
  )
}

/** Style tray controls (DESIGN.md: only the ones that apply). A null value hides its group. */
function TrayControls({
  color,
  fill,
  width,
  onColor,
  onFill,
  onWidth,
}: {
  color: PaletteColor | null
  fill: Fill | null
  width: PenWidth | null
  onColor: (color: PaletteColor) => void
  onFill: (fill: Fill) => void
  onWidth: (width: PenWidth) => void
}) {
  const theme = useResolvedTheme()
  const currentShades = paletteShades(color ?? "ink", theme)

  return (
    <div
      role="toolbar"
      aria-label="Style"
      className="flex animate-in items-center gap-1 border-b bg-muted/50 px-2 py-1.5 duration-(--duration-panel) ease-out fade-in slide-in-from-bottom-2"
    >
      {PALETTE_COLORS.map((option) => {
        const shades = paletteShades(option, theme)
        return (
          <button
            key={option}
            type="button"
            aria-label={`Color ${option}`}
            aria-pressed={color === option}
            onClick={() => onColor(option)}
            className={cn(
              "size-6 rounded-full border-2 transition-transform duration-(--duration-press) ease-out active:scale-90 pointer-coarse:size-9",
              color === option && "ring-2 ring-primary ring-offset-2 ring-offset-muted",
            )}
            style={{ background: shades.fill, borderColor: shades.stroke }}
          />
        )
      })}
      {fill !== null && (
        <>
          <span className="mx-1.5 h-5 w-px bg-border" />
          {FILLS.map((option) => (
            <Hint key={option.fill} label={option.label}>
              <button
                type="button"
                aria-label={option.label}
                aria-pressed={fill === option.fill}
                onClick={() => onFill(option.fill)}
                className={cn(
                  "size-6 rounded-sm border-2 transition-transform duration-(--duration-press) ease-out active:scale-90 pointer-coarse:size-9",
                  fill === option.fill && "ring-2 ring-primary ring-offset-2 ring-offset-muted",
                )}
                style={{
                  borderColor: currentShades.stroke,
                  background:
                    option.fill === "none"
                      ? "transparent"
                      : option.fill === "solid"
                        ? currentShades.stroke
                        : currentShades.fill,
                }}
              />
            </Hint>
          ))}
        </>
      )}
      {width !== null && (
        <>
          <span className="mx-1.5 h-5 w-px bg-border" />
          {WIDTHS.map((option) => (
            <Hint key={option.width} label={option.label}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={option.label}
                aria-pressed={width === option.width}
                onClick={() => onWidth(option.width)}
                className={cn(
                  "type-label",
                  width === option.width &&
                    "bg-primary-subtle text-primary hover:bg-primary-subtle",
                )}
              >
                {option.width}
              </Button>
            </Hint>
          ))}
        </>
      )}
      <span className="mx-1.5 h-5 w-px bg-border" />
      <Hint label="Lock (coming soon)">
        <Button variant="ghost" size="icon-sm" aria-label="Lock" disabled>
          <Lock />
        </Button>
      </Hint>
      <Hint label="More (coming soon)">
        <Button variant="ghost" size="icon-sm" aria-label="More" disabled>
          <Ellipsis />
        </Button>
      </Hint>
    </div>
  )
}

function useUndoState(undoManager: Y.UndoManager) {
  const read = () => ({ canUndo: undoManager.canUndo(), canRedo: undoManager.canRedo() })
  const [state, setState] = useState(read)
  useEffect(() => {
    const update = () => setState(read())
    undoManager.on("stack-item-added", update)
    undoManager.on("stack-item-popped", update)
    undoManager.on("stack-cleared", update)
    return () => {
      undoManager.off("stack-item-added", update)
      undoManager.off("stack-item-popped", update)
      undoManager.off("stack-cleared", update)
    }
  })
  return state
}

/** Bottom-right pill: undo/redo, then zoom (DESIGN.md C1). */
export function UndoZoomPill({
  undoManager,
  canvas,
  canEdit,
}: {
  undoManager: Y.UndoManager
  canvas: React.RefObject<CanvasHandle | null>
  canEdit: boolean
}) {
  const zoom = useBoardUi((s) => s.zoom)
  const { canUndo, canRedo } = useUndoState(undoManager)

  return (
    <div className={cn(PANEL, "fixed right-3 bottom-3 flex items-center gap-0.5 rounded-full p-1")}>
      {canEdit && (
        <>
          <Hint label="Undo" shortcut="Ctrl Z">
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label="Undo"
              disabled={!canUndo}
              onClick={() => undoManager.undo()}
            >
              <Undo2 />
            </Button>
          </Hint>
          <Hint label="Redo" shortcut="Shift Ctrl Z">
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              aria-label="Redo"
              disabled={!canRedo}
              onClick={() => undoManager.redo()}
            >
              <Redo2 />
            </Button>
          </Hint>
          <span className="mx-0.5 h-5 w-px bg-border" />
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" className="type-mono gap-0.5 rounded-full px-2.5" />
          }
        >
          {Math.round(zoom * 100)}%
          <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-44">
          <DropdownMenuItem onClick={() => canvas.current?.zoomBy(1.25)}>Zoom in</DropdownMenuItem>
          <DropdownMenuItem onClick={() => canvas.current?.zoomBy(0.8)}>Zoom out</DropdownMenuItem>
          <DropdownMenuItem onClick={() => canvas.current?.fit()}>
            Zoom to fit <span className="type-mono ml-auto text-muted-foreground">Shift 1</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => canvas.current?.zoomTo(1)}>
            Zoom to 100%
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
