import latinExtUrl from "@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2?url"
import latinUrl from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url"
import type { ElementWithId, ImageElement } from "@syncanvas/board-model"
import {
  boundsOf,
  drawImage,
  EXPORT_MAX_SIDE,
  imageSize,
  type Theme,
  toSvg,
} from "@syncanvas/renderer"
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

// ---------- SVG (M6 ticket 02) ----------

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

/** Unicode ranges of the two Geist files embedded (from Fontsource's own CSS). */
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"

let fontCss: Promise<string> | null = null

/**
 * `@font-face` rules embedding Geist (Latin and Latin Extended, all weights: it's a variable
 * font), so an SVG shows the same text anywhere. Other scripts fall back to system fonts.
 */
function geistFontCss(): Promise<string> {
  fontCss ??= Promise.all(
    [latinUrl, latinExtUrl].map(async (url) => dataUrl(await (await fetch(url)).blob())),
  )
    .then(([latin, latinExt]) =>
      [
        [latin, LATIN],
        [latinExt, LATIN_EXT],
      ]
        .map(
          ([src, range]) =>
            `@font-face{font-family:"Geist Variable";font-style:normal;font-weight:100 900;src:url(${src}) format("woff2");unicode-range:${range};}`,
        )
        .join(""),
    )
    .catch((error) => {
      fontCss = null // try again next time
      throw error
    })
  return fontCss
}

/** Each image's file as a data URL, so the SVG stands alone; null where it couldn't be read. */
async function imageDataUrls(elements: readonly ElementWithId[]) {
  const keys = [...new Set(elements.flatMap((e) => (e.type === "image" ? [e.key] : [])))]
  const urls = new Map<string, string>()
  await Promise.all(
    keys.map(async (key) => {
      try {
        urls.set(key, await dataUrl(await imageCache.blob(key)))
      } catch {
        // Drawn as its placeholder.
      }
    }),
  )
  return (e: ImageElement) => urls.get(e.key) ?? null
}

/** The Elements as a standalone SVG (`byId` holds every Element, for connector ends). */
export async function exportSvg(
  elements: readonly ElementWithId[],
  byId: ReadonlyMap<string, ElementWithId>,
  theme: Theme,
): Promise<Blob> {
  const [css, imageData] = await Promise.all([geistFontCss(), imageDataUrls(elements)])
  const bounds = boundsOf(elements, byId) ?? { x: 0, y: 0, w: 1, h: 1 }
  const svg = toSvg(elements, byId, bounds, { theme, imageData, fontCss: css })
  return new Blob([svg], { type: "image/svg+xml" })
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
