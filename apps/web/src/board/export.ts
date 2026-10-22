import type { ElementWithId } from "@syncanvas/board-model"
import { boundsOf, drawImage, EXPORT_MAX_SIDE, imageSize, type Theme } from "@syncanvas/renderer"
import { imageCache } from "./images"

// Export (M6; PRD A8, DESIGN.md → Export): the whole Board or the selection, drawn in the
// browser from the same renderer as the screen. Elements only: no pins, cursors, or selection.

export type ExportFormat = "png" | "svg" | "pdf"
export type ExportScope = "selection" | "board"

/** Pixels per canvas unit in a PNG export. */
export const PNG_SCALE = 2

/** What gets exported: the selection (in drawing order), or every Element. */
export function exportElements(
  all: readonly ElementWithId[],
  selection: ReadonlySet<string>,
  scope: ExportScope,
): ElementWithId[] {
  return scope === "selection" ? all.filter((e) => selection.has(e.id)) : [...all]
}

/** A file name from the Board's title, safe on every system. */
export function exportFileName(title: string | undefined, format: ExportFormat) {
  // Control characters out first (no file name can hold them), then the reserved ones.
  const printable = [...(title ?? "")].filter((ch) => ch.charCodeAt(0) >= 32).join("")
  const base = printable
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
  return `${base || "Board"}.${format}`
}

/**
 * The PNG's size for `bounds`, and the percentage of the asked-for 2× it got: below 100 when
 * the 8,192 px cap shrank it.
 */
export function pngSize(bounds: { w: number; h: number }) {
  const size = imageSize(bounds, PNG_SCALE, 16, EXPORT_MAX_SIDE)
  return { size, percent: Math.round((size.scale / PNG_SCALE) * 100) }
}

export type ExportResult = { blob: Blob; percent: number }

/** How long an export waits for image files still on their way. */
const IMAGES_WAIT_MS = 15_000

/** Waits until every image among `elements` has loaded (or been given up on), up to 15 s. */
export function imagesReady(elements: readonly ElementWithId[]): Promise<void> {
  const pictures = elements.filter((e) => e.type === "image")
  const loading = () => pictures.some((e) => imageCache.get(e) === "loading")
  if (!loading()) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      unsubscribe()
      resolve()
    }
    const timer = setTimeout(done, IMAGES_WAIT_MS)
    const unsubscribe = imageCache.subscribe(() => {
      if (!loading()) done()
    })
  })
}

/** Draws the Elements as a PNG (`byId` holds every Element, for connector ends). */
export async function exportPng(
  elements: readonly ElementWithId[],
  byId: ReadonlyMap<string, ElementWithId>,
  theme: Theme,
): Promise<ExportResult> {
  await imagesReady(elements)
  const bounds = boundsOf(elements, byId) ?? { x: 0, y: 0, w: 1, h: 1 }
  const { size, percent } = pngSize(bounds)
  const canvas = document.createElement("canvas")
  canvas.width = size.w
  canvas.height = size.h
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("No 2D context")
  drawImage(ctx, elements, byId, bounds, size, 16, imageCache.get, theme)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("The browser couldn't make the PNG")
  return { blob, percent }
}

/** Starts a download of `blob` as `name`. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  // Long enough for the browser to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
