import {
  type Alignment,
  type ConnectorStyle,
  elementsOf,
  type Fill,
  PALETTE_COLORS,
  type PaletteColor,
  type PenWidth,
  recolorElement,
  STICKY_COLORS,
  type StickyColor,
  setConnectorStyle,
  setFill,
  setPenWidth,
  setTextStyle,
  type TextAlign,
  type TextSize,
} from "@syncanvas/board-model"
import { paletteShades, stickyBackground } from "@syncanvas/renderer"
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  Bold,
  ChevronDown,
  Circle,
  CornerDownRight,
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
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { keyLabel } from "@/lib/keys"
import { useResolvedTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import {
  arrangeSelection,
  groupSelection,
  reorderSelection,
  selectionCommands,
  toggleLock,
  ungroupSelection,
} from "./actions"
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
  { id: "arrow", label: "Arrow", shortcut: "A", icon: MoveUpRight },
  { id: "connector", label: "Connector", shortcut: "C", icon: Spline },
  { id: "text", label: "Text", shortcut: "T", icon: Type },
  { id: "sticky", label: "Sticky note", shortcut: "S", icon: StickyNote },
  { id: null, label: "Image", icon: Image },
  { id: null, label: "Comment", icon: MessageCircle },
]

/** Which colors the tray offers: Palette colors, or sticky note backgrounds. */
type ColorSet = "palette" | "sticky"

/** Element types that have a fill (spec: style tray per type). */
const SHAPE_TYPES = new Set(["rect", "ellipse"])
const PEN_TYPES = new Set(["pen"])
const CONNECTOR_TYPES = new Set(["connector"])

const CONNECTOR_STYLES: { style: ConnectorStyle; label: string; icon: typeof Spline }[] = [
  { style: "straight", label: "Straight", icon: MoveUpRight },
  { style: "elbow", label: "Elbow", icon: CornerDownRight },
]

const TEXT_TYPES = new Set(["text"])
const STICKY_TYPES = new Set(["sticky"])
const TEXT_OR_STICKY_TYPES = new Set(["text", "sticky"])

/** A selection whose Elements disagree on a value: the tray shows no option pressed. */
const MIXED = "mixed"
type Shared<T> = T | typeof MIXED

/**
 * Text style controls. `bold` is pressed only when everything is bold. `align` is null and
 * `xl` false when sticky notes are selected (they have neither).
 */
type TextStyle = {
  fontSize: Shared<TextSize>
  bold: boolean
  align: Shared<TextAlign> | null
  xl: boolean
}

const TEXT_SIZES_UI: { size: TextSize; label: string }[] = [
  { size: "S", label: "Size S" },
  { size: "M", label: "Size M" },
  { size: "L", label: "Size L" },
  { size: "XL", label: "Size XL" },
]

/** The ⋯ menu's Align entries (aligning the selection, not text). */
const ALIGNMENTS: { alignment: Alignment; label: string; icon: typeof AlignLeft }[] = [
  { alignment: "left", label: "Left", icon: AlignStartVertical },
  { alignment: "center", label: "Center", icon: AlignCenterVertical },
  { alignment: "right", label: "Right", icon: AlignEndVertical },
  { alignment: "top", label: "Top", icon: AlignStartHorizontal },
  { alignment: "middle", label: "Middle", icon: AlignCenterHorizontal },
  { alignment: "bottom", label: "Bottom", icon: AlignEndHorizontal },
]

const ALIGNS: { align: TextAlign; label: string; icon: typeof AlignLeft }[] = [
  { align: "left", label: "Align left", icon: AlignLeft },
  { align: "center", label: "Align center", icon: AlignCenter },
  { align: "right", label: "Align right", icon: AlignRight },
]

/**
 * Board menus give focus back to their button only when used from the keyboard. After a
 * pointer pick the focus is let go, so Board shortcuts (Escape, Delete, Ctrl+Z…) keep
 * working: a focused menu button would swallow Escape.
 */
const keyboardOnlyFinalFocus = (closeType: string) => closeType === "keyboard"

/** A tray button that's on or off, marked like an active tool (`primary-subtle`). */
function ToggleButton({
  label,
  shortcut,
  pressed,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  pressed: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Hint label={label} shortcut={shortcut}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        className={cn(
          // Keys toggle these too (Ctrl+B): only the press scales, the state change is instant.
          "type-label transition-transform",
          pressed && "bg-primary-subtle text-primary hover:bg-primary-subtle",
        )}
      >
        {children}
      </Button>
    </Hint>
  )
}

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
        {shortcut ? <Kbd>{keyLabel(shortcut)}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** Bottom-center dock: the tool row, with a style tray that grows out of it for a selection. */
export function Dock({
  doc,
  origin,
  undoManager,
  canEdit,
}: {
  doc: Y.Doc
  origin: object
  undoManager: Y.UndoManager
  canEdit: boolean
}) {
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
      {tray === "selection" && (
        <SelectionTray doc={doc} origin={origin} undoManager={undoManager} selection={selection} />
      )}
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
                  // Switching tools never animates (DESIGN.md Motion); only the press scales.
                  "transition-transform",
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
  undoManager,
  selection,
}: {
  doc: Y.Doc
  origin: object
  undoManager: Y.UndoManager
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
      const all = (types: Set<string>) => fields.every((f) => types.has(f?.get("type") as string))
      // A value every selected Element shares, or MIXED (no option shows pressed).
      const shared = (key: string, fallback?: unknown) => {
        const values = new Set(fields.map((f) => f?.get(key) ?? fallback))
        return values.size === 1 ? [...values][0] : MIXED
      }
      const stickies = all(STICKY_TYPES)
      const anySticky = fields.some((f) => f?.get("type") === "sticky")
      const texts = all(TEXT_TYPES)
      // Only the controls the whole selection shares (spec: style tray per type).
      return JSON.stringify([
        selectionCommands(doc, selection),
        shared("color"),
        // Sticky notes have their own colors, so a mix with other types shows no colors.
        stickies ? "sticky" : anySticky ? null : "palette",
        all(SHAPE_TYPES) ? shared("fill", "light") : null,
        all(PEN_TYPES) ? shared("width") : null,
        // Text and stickies share size (S/M/L) and bold; alignment and XL are text-only.
        texts || all(TEXT_OR_STICKY_TYPES)
          ? {
              fontSize: shared("fontSize"),
              bold: fields.every((f) => f?.get("bold") === true),
              align: texts ? shared("align") : null,
              xl: texts,
            }
          : null,
        all(CONNECTOR_TYPES) ? shared("style") : null,
      ])
    },
  )
  const [commands, color, colors, fill, width, text, style] = JSON.parse(snapshot) as [
    ReturnType<typeof selectionCommands>,
    Shared<PaletteColor> | null,
    ColorSet | null,
    Shared<Fill> | null,
    Shared<PenWidth> | null,
    TextStyle | null,
    Shared<ConnectorStyle> | null,
  ]
  const context = { doc, origin, undoManager }
  const actions = <SelectionActions context={context} commands={commands} />
  // Locked: hands off until unlocked, so the tray offers nothing else.
  if (commands.locked) {
    return (
      <TrayControls
        color={null}
        colors={null}
        fill={null}
        width={null}
        text={null}
        onColor={() => {}}
        actions={actions}
      />
    )
  }
  return (
    <TrayControls
      color={color}
      colors={colors}
      fill={fill}
      width={width}
      text={text}
      style={style}
      actions={actions}
      onStyle={(value) => {
        for (const id of selection) setConnectorStyle(doc, id, value, origin)
        // The next connector gets the style last picked.
        useBoardUi.getState().setConnectorStyle(value)
      }}
      onColor={(value) => {
        for (const id of selection) recolorElement(doc, id, value, origin)
        // The next sticky note gets the color last picked for one.
        if (colors === "sticky") useBoardUi.getState().setStickyColor(value as StickyColor)
      }}
      onText={(value) => {
        for (const id of selection) setTextStyle(doc, id, value, origin)
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
      colors="palette"
      fill={null}
      width={pen.width}
      text={null}
      onColor={(color) => setPen({ ...pen, color })}
      onWidth={(width) => setPen({ ...pen, width })}
    />
  )
}

/** Style tray controls (DESIGN.md: only the ones that apply). A null value hides its group. */
function TrayControls({
  color,
  colors,
  fill,
  width,
  text,
  style = null,
  actions,
  onColor,
  onFill,
  onWidth,
  onText,
  onStyle,
}: {
  color: Shared<PaletteColor> | null
  colors: ColorSet | null
  fill: Shared<Fill> | null
  width: Shared<PenWidth> | null
  text: TextStyle | null
  /** A connector's straight or elbow. */
  style?: Shared<ConnectorStyle> | null
  /** Lock and ⋯, for a selection. */
  actions?: React.ReactNode
  onColor: (color: PaletteColor) => void
  onFill?: (fill: Fill) => void
  onWidth?: (width: PenWidth) => void
  onText?: (style: { fontSize?: TextSize; bold?: boolean; align?: TextAlign }) => void
  onStyle?: (style: ConnectorStyle) => void
}) {
  const theme = useResolvedTheme()
  // Fill previews use the selection's color, or ink when colors are mixed.
  const currentShades = paletteShades(color && color !== MIXED ? color : "ink", theme)

  return (
    <div
      role="toolbar"
      aria-label="Style"
      // Keep focus where it is (the text being typed into stays in edit mode).
      onMouseDown={(e) => e.preventDefault()}
      className="flex animate-in items-center justify-center gap-1 border-b bg-muted/50 px-2 py-1.5 duration-(--duration-panel) ease-out fade-in slide-in-from-bottom-2"
    >
      {(colors === "sticky" ? STICKY_COLORS : colors === "palette" ? PALETTE_COLORS : []).map(
        (option) => {
          const shades = paletteShades(option, theme)
          return (
            <button
              key={option}
              type="button"
              aria-label={`Color ${option}`}
              aria-pressed={color === option}
              onClick={() => onColor(option)}
              className={cn(
                "size-6 rounded-full border-2 transition-transform duration-(--duration-press) ease-out active:scale-[0.95] pointer-coarse:size-9",
                colors === "sticky" && "rounded-sm border border-foreground/15",
                color === option && "ring-2 ring-primary ring-offset-2 ring-offset-muted",
              )}
              style={
                colors === "sticky"
                  ? { background: stickyBackground(option as StickyColor, theme) }
                  : { background: shades.fill, borderColor: shades.stroke }
              }
            />
          )
        },
      )}
      {fill !== null && (
        <>
          <span className="mx-1.5 h-5 w-px bg-border" />
          {FILLS.map((option) => (
            <Hint key={option.fill} label={option.label}>
              <button
                type="button"
                aria-label={option.label}
                aria-pressed={fill === option.fill}
                onClick={() => onFill?.(option.fill)}
                className={cn(
                  "size-6 rounded-sm border-2 transition-transform duration-(--duration-press) ease-out active:scale-[0.95] pointer-coarse:size-9",
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
            <ToggleButton
              key={option.width}
              label={option.label}
              pressed={width === option.width}
              onClick={() => onWidth?.(option.width)}
            >
              {option.width}
            </ToggleButton>
          ))}
        </>
      )}
      {style !== null && (
        <>
          <span className="mx-1.5 h-5 w-px bg-border" />
          {CONNECTOR_STYLES.map((option) => (
            <ToggleButton
              key={option.style}
              label={option.label}
              pressed={style === option.style}
              onClick={() => onStyle?.(option.style)}
            >
              <option.icon />
            </ToggleButton>
          ))}
        </>
      )}
      {text !== null && (
        <>
          {colors !== null && <span className="mx-1.5 h-5 w-px bg-border" />}
          {TEXT_SIZES_UI.filter((option) => text.xl || option.size !== "XL").map((option) => (
            <ToggleButton
              key={option.size}
              label={option.label}
              pressed={text.fontSize === option.size}
              onClick={() => onText?.({ fontSize: option.size })}
            >
              {option.size}
            </ToggleButton>
          ))}
          <ToggleButton
            label="Bold"
            shortcut="Mod B"
            pressed={text.bold}
            onClick={() => onText?.({ bold: !text.bold })}
          >
            <Bold />
          </ToggleButton>
          {text.align !== null && <span className="mx-1.5 h-5 w-px bg-border" />}
          {text.align !== null &&
            ALIGNS.map((option) => (
              <ToggleButton
                key={option.align}
                label={option.label}
                pressed={text.align === option.align}
                onClick={() => onText?.({ align: option.align })}
              >
                <option.icon />
              </ToggleButton>
            ))}
        </>
      )}
      {actions &&
        (colors !== null || fill !== null || width !== null || text !== null || style !== null) && (
          <span className="mx-1.5 h-5 w-px bg-border" />
        )}
      {actions}
    </div>
  )
}

/** Lock and the ⋯ menu (group, ungroup, Lock), at the end of every selection tray. */
function SelectionActions({
  context,
  commands,
}: {
  context: Parameters<typeof toggleLock>[0]
  commands: ReturnType<typeof selectionCommands>
}) {
  return (
    <>
      <ToggleButton
        label={commands.locked ? "Unlock" : "Lock"}
        shortcut="Mod Shift L"
        pressed={commands.locked}
        onClick={() => toggleLock(context)}
      >
        <Lock />
      </ToggleButton>
      <DropdownMenu>
        <Hint label="More">
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More" />}>
            <Ellipsis />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent
          align="end"
          side="top"
          className="w-56"
          finalFocus={keyboardOnlyFinalFocus}
        >
          <DropdownMenuItem
            disabled={!commands.canReorder}
            onClick={() => reorderSelection(context, "forward")}
          >
            Bring forward
            <DropdownMenuShortcut>{keyLabel("Mod ]")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!commands.canReorder}
            onClick={() => reorderSelection(context, "backward")}
          >
            Send backward
            <DropdownMenuShortcut>{keyLabel("Mod [")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!commands.canAlign}>Align</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              {ALIGNMENTS.map((option) => (
                <DropdownMenuItem
                  key={option.alignment}
                  onClick={() => arrangeSelection(context, option.alignment)}
                >
                  <option.icon />
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!commands.canDistribute}>
              Distribute
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-44">
              <DropdownMenuItem onClick={() => arrangeSelection(context, "horizontal")}>
                <AlignHorizontalSpaceAround />
                Horizontally
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => arrangeSelection(context, "vertical")}>
                <AlignVerticalSpaceAround />
                Vertically
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!commands.canGroup} onClick={() => groupSelection(context)}>
            Group
            <DropdownMenuShortcut>{keyLabel("Mod G")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!commands.canUngroup}
            onClick={() => ungroupSelection(context)}
          >
            Ungroup
            <DropdownMenuShortcut>{keyLabel("Mod Shift G")}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toggleLock(context)}>
            {commands.locked ? "Unlock" : "Lock"}
            <DropdownMenuShortcut>{keyLabel("Mod Shift L")}</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
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
          <Hint label="Undo" shortcut="Mod Z">
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
          <Hint label="Redo" shortcut="Mod Shift Z">
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
        <DropdownMenuContent
          align="end"
          side="top"
          className="w-44"
          finalFocus={keyboardOnlyFinalFocus}
        >
          <DropdownMenuItem onClick={() => canvas.current?.zoomBy(1.25)}>Zoom in</DropdownMenuItem>
          <DropdownMenuItem onClick={() => canvas.current?.zoomBy(0.8)}>Zoom out</DropdownMenuItem>
          <DropdownMenuItem onClick={() => canvas.current?.fit()}>
            Zoom to fit <span className="type-mono ml-auto text-muted-foreground">Shift 1</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => canvas.current?.zoomTo(1)}>
            Zoom to 100%
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => useBoardUi.getState().setShortcutsOpen("pointer")}>
            Keyboard shortcuts
            <DropdownMenuShortcut>?</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
