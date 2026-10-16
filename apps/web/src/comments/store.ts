import type { Camera } from "@syncanvas/renderer"
import type { ThreadAnchor } from "@syncanvas/shared"
import { create } from "zustand"

// Comment UI state for the Board screen (M4): the Thread card that's open, a new Thread being
// written, and what the pin layer needs from the canvas to place pins.

export type Box = { x: number; y: number; w: number; h: number }

type Comments = {
  /** The Thread whose card is open. */
  open: string | null
  /** A new Thread being written: where its pin goes. It's saved with the first comment. */
  draft: ThreadAnchor | null
  openThread: (id: string | null) => void
  startDraft: (anchor: ThreadAnchor) => void
  close: () => void
}

export const useComments = create<Comments>((set) => ({
  open: null,
  draft: null,
  openThread: (open) => set({ open, draft: null }),
  startDraft: (draft) => set({ draft, open: null }),
  close: () => set({ open: null, draft: null }),
}))

type CanvasView = {
  camera: Camera
  /** Bumped on every canvas frame, so pins follow pans, zooms, and moving Elements. */
  frame: number
  /** An Element's box as drawn, in world units, or null if it doesn't exist. */
  boxOf: (id: string) => Box | null
}

/** Published by the canvas on every frame it draws; read by the pin layer. */
export const useCanvasView = create<CanvasView>(() => ({
  camera: { x: 0, y: 0, zoom: 1 },
  frame: 0,
  boxOf: () => null,
}))

/** Where an anchor sits on the Board right now (world units), or null if its Element is gone. */
export function anchorPoint(
  anchor: ThreadAnchor,
  boxOf: (id: string) => Box | null,
  last: { x: number; y: number } | null = null,
): { x: number; y: number } | null {
  if (!("elementId" in anchor)) return { x: anchor.x, y: anchor.y }
  const box = boxOf(anchor.elementId)
  if (!box) return last
  return { x: box.x + anchor.fx * box.w, y: box.y + anchor.fy * box.h }
}
