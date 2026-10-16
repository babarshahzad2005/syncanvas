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
  /** Resolved Threads show in the list and on the Board (M4 ticket 02). */
  showResolved: boolean
  /** A place for the canvas to center on (bumped each time, so the same place works twice). */
  panTo: { x: number; y: number; seq: number } | null
  openThread: (id: string | null) => void
  startDraft: (anchor: ThreadAnchor) => void
  close: () => void
  setShowResolved: (show: boolean) => void
  /** Opens a Thread's card and brings its pin into view. */
  focus: (id: string, at: { x: number; y: number } | null) => void
}

export const useComments = create<Comments>((set) => ({
  open: null,
  draft: null,
  showResolved: false,
  panTo: null,
  openThread: (open) => set({ open, draft: null }),
  startDraft: (draft) => set({ draft, open: null }),
  close: () => set({ open: null, draft: null }),
  setShowResolved: (showResolved) => set({ showResolved }),
  focus: (open, at) =>
    set((s) => ({
      open,
      draft: null,
      panTo: at ? { ...at, seq: (s.panTo?.seq ?? 0) + 1 } : s.panTo,
    })),
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

/**
 * Where an anchor sits on the Board right now (world units). A pin whose Element is gone sits
 * at the same spot of the Element's last box, as a Detached Thread (ADR 0012); without one,
 * it has nowhere to be (null).
 */
export function anchorPoint(
  anchor: ThreadAnchor,
  boxOf: (id: string) => Box | null,
  lastBoxes: ReadonlyMap<string, Box> = new Map(),
): { x: number; y: number; detached: boolean } | null {
  if (!("elementId" in anchor)) return { x: anchor.x, y: anchor.y, detached: false }
  const box = boxOf(anchor.elementId)
  const at = box ?? lastBoxes.get(anchor.elementId)
  if (!at) return null
  return { x: at.x + anchor.fx * at.w, y: at.y + anchor.fy * at.h, detached: !box }
}
