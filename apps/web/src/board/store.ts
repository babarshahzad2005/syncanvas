import { create } from "zustand"

/** Local, per-tab UI state for the Board screen (TECH_STACK §3: Zustand for UI state). */
export type Tool = "select" | "rect"

type BoardUi = {
  tool: Tool
  selection: ReadonlySet<string>
  zoom: number
  setTool: (tool: Tool) => void
  select: (ids: Iterable<string>) => void
  setZoom: (zoom: number) => void
}

export const useBoardUi = create<BoardUi>((set) => ({
  tool: "select",
  selection: new Set(),
  zoom: 1,
  setTool: (tool) => set({ tool }),
  select: (ids) => set({ selection: new Set(ids) }),
  setZoom: (zoom) => set({ zoom }),
}))
