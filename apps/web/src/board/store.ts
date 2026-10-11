import type { PaletteColor, PenWidth } from "@syncanvas/board-model"
import { create } from "zustand"

/** Local, per-tab UI state for the Board screen (TECH_STACK §3: Zustand for UI state). */
export type Tool = "select" | "pen" | "rect" | "ellipse" | "arrow"

/** Tools that drag out an Element from one corner (or end) to the other. */
export const DRAG_TOOLS = ["rect", "ellipse", "arrow"] as const
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
  setTool: (tool) => set({ tool }),
  select: (ids) => set({ selection: new Set(ids) }),
  setZoom: (zoom) => set({ zoom }),
}))
