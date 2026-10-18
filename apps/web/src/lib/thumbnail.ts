import type { ElementWithId } from "@syncanvas/board-model"
import { boundsOf, type Camera, drawScene } from "@syncanvas/renderer"
import { THUMBNAIL_EVERY_MS, THUMBNAIL_MAX_BYTES } from "@syncanvas/shared"
import { ApiError, api } from "@/lib/api"

// Board thumbnails (M5a ticket 05; FLOWS §6): the whole Board drawn small in the light theme,
// uploaded when an Editor leaves a Board they changed. Templates' dashboard previews share the
// fitting.

/**
 * Fits `bounds` in the box with `padding` around it, however small that makes it (the
 * canvas's own fit stops at 10%), and never larger than `maxZoom`.
 */
export function fitAll(
  bounds: { x: number; y: number; w: number; h: number } | null,
  box: { w: number; h: number },
  padding = 8,
  maxZoom = Number.POSITIVE_INFINITY,
): Camera {
  if (!bounds) return { x: 0, y: 0, zoom: 1 }
  const zoom = Math.min(
    maxZoom,
    (box.w - padding * 2) / Math.max(bounds.w, 1),
    (box.h - padding * 2) / Math.max(bounds.h, 1),
  )
  return {
    zoom,
    x: box.w / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: box.h / 2 - (bounds.y + bounds.h / 2) * zoom,
  }
}

/** The tiles are 16:10; this is about twice their width on a large screen. */
const SIZE = { w: 640, h: 400 }

/** The Board as a WebP (PNG where the browser can't make WebP), or null if it can't draw. */
export function renderThumbnail(
  elements: readonly ElementWithId[],
  byId: ReadonlyMap<string, ElementWithId>,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas")
  canvas.width = SIZE.w
  canvas.height = SIZE.h
  const ctx = canvas.getContext("2d")
  if (!ctx) return Promise.resolve(null)
  drawScene(ctx, {
    elements,
    byId,
    // A single sticky note shouldn't fill the tile.
    camera: fitAll(boundsOf(elements, byId), SIZE, 32, 1),
    theme: "light",
    size: SIZE,
    dpr: 1,
    selection: new Set(),
    showGrid: false,
  })
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.8))
}

/** When this tab last uploaded (or was told it's too soon) per Board, to skip doomed requests. */
const lastUpload = new Map<string, number>()

export function thumbnailDue(boardId: string, now = Date.now()) {
  return now - (lastUpload.get(boardId) ?? 0) >= THUMBNAIL_EVERY_MS
}

/**
 * Renders and uploads; resolves true once it's stored. Failures are silent (the dashboard keeps
 * the old picture). `closing`: the tab may be going away, so the request must outlive it.
 */
export async function uploadThumbnail(
  boardId: string,
  elements: readonly ElementWithId[],
  byId: ReadonlyMap<string, ElementWithId>,
  closing: boolean,
): Promise<boolean> {
  try {
    const blob = await renderThumbnail(elements, byId)
    if (!blob || blob.size > THUMBNAIL_MAX_BYTES) return false
    // Browsers only let a request outlive the page if its body is under 64 KB.
    await api.uploadThumbnail(boardId, blob, closing && blob.size < 60_000)
    lastUpload.set(boardId, Date.now())
    return true
  } catch (error) {
    if (error instanceof ApiError && error.status === 429) lastUpload.set(boardId, Date.now())
    return false
  }
}
