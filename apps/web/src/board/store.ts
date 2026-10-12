import type { ConnectorStyle, PaletteColor, PenWidth, StickyColor } from "@syncanvas/board-model"
import { create } from "zustand"

/** Local, per-tab UI state for the Board screen (TECH_STACK §3: Zustand for UI state). */
export type Tool = "select" | "pen" | "rect" | "ellipse" | "arrow" | "connector" | "text" | "sticky"

/**
 * Tools that place an Element when the pointer is released: dragged out from one corner (or
 * end) to the other, or, for text and sticky notes, placed with a click.
 */
export const DRAG_TOOLS = ["rect", "ellipse", "arrow", "text", "sticky"] as const
export type DragTool = (typeof DRAG_TOOLS)[number]
export const isDragTool = (tool: Tool): tool is DragTool =>
  (DRAG_TOOLS as readonly Tool[]).includes(tool)

type BoardUi = {
  tool: Tool
  selection: ReadonlySet<string>
  zoom: number
  /** Color and width for the next pen strokes. */
  pen: { color: PaletteColor; width: PenWidth }
  setPen: (pen: { color: PaletteColor; width: PenWidth }) => void
  /** Color of the next sticky note: the sticky color last picked in the tray. */
  stickyColor: StickyColor
  setStickyColor: (color: StickyColor) => void
  /** Style of the next connector: the style last picked in the tray (elbow at first). */
  connectorStyle: ConnectorStyle
  setConnectorStyle: (style: ConnectorStyle) => void
  /** The text being typed into, if any (`continuing`: see TextEditor). */
  editing: { id: string; continuing: boolean } | null
  setEditing: (editing: { id: string; continuing: boolean } | null) => void
  setTool: (tool: Tool) => void
  select: (ids: Iterable<string>) => void
  setZoom: (zoom: number) => void
}

export const useBoardUi = create<BoardUi>((set) => ({
  tool: "select",
  selection: new Set(),
  zoom: 1,
  pen: { color: "ink", width: "M" },
  setPen: (pen) => set({ pen }),
  stickyColor: "yellow",
  setStickyColor: (stickyColor) => set({ stickyColor }),
  connectorStyle: "elbow",
  setConnectorStyle: (connectorStyle) => set({ connectorStyle }),
  editing: null,
  setEditing: (editing) => set({ editing }),
  setTool: (tool) => set({ tool }),
  select: (ids) => set({ selection: new Set(ids) }),
  setZoom: (zoom) => set({ zoom }),
}))
