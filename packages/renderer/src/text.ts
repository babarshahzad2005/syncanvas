import type { TextSize } from "@syncanvas/board-model"

// Text layout shared by the canvas and the editing textarea (spec: "the renderer lays out
// text with Geist exactly like the textarea"). The textarea uses the same font, size, line
// height, and width in world units, scaled by the zoom, so both break lines the same way:
// `white-space: pre-wrap` + `overflow-wrap: break-word` for fixed width, `pre` for auto width.

/** Text Element font sizes in canvas units (DESIGN.md typography.canvas). */
export const TEXT_SIZES: Record<TextSize, number> = { S: 16, M: 20, L: 28, XL: 40 }
/** Line height as a multiple of the font size. */
export const LINE_HEIGHT = 1.3
export const TEXT_FONT_FAMILY = '"Geist Variable", ui-sans-serif, system-ui, sans-serif'

export function textFont(fontSize: number, bold: boolean): string {
  return `${bold ? 600 : 400} ${fontSize}px ${TEXT_FONT_FAMILY}`
}

export type TextLayout = {
  lines: { text: string; width: number }[]
  /** Width of the widest line. */
  width: number
  height: number
  lineHeight: number
  /** Distance from a line's top to its baseline (CSS half-leading model). */
  baseline: number
}

// ---------- Measuring ----------

let context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined

function measureContext() {
  if (context !== undefined) return context
  if (typeof OffscreenCanvas !== "undefined") context = new OffscreenCanvas(1, 1).getContext("2d")
  else if (typeof document !== "undefined")
    context = document.createElement("canvas").getContext("2d")
  else context = null // tests in Node: estimate instead
  return context
}

function measure(text: string, font: string, fontSize: number): number {
  const ctx = measureContext()
  if (!ctx) return text.length * fontSize * 0.55
  ctx.font = font
  return ctx.measureText(text).width
}

function baselineOf(font: string, fontSize: number, lineHeight: number): number {
  const ctx = measureContext()
  let ascent = fontSize * 0.8
  let descent = fontSize * 0.2
  if (ctx) {
    ctx.font = font
    const metrics = ctx.measureText("Hg")
    if (metrics.fontBoundingBoxAscent !== undefined) {
      ascent = metrics.fontBoundingBoxAscent
      descent = metrics.fontBoundingBoxDescent
    }
  }
  return (lineHeight - (ascent + descent)) / 2 + ascent
}

// ---------- Layout ----------

const cache = new Map<string, TextLayout>()
const CACHE_LIMIT = 5000

/** Forget measured layouts, e.g. once the web font has loaded and metrics changed. */
export function clearTextLayoutCache() {
  cache.clear()
}

/**
 * Lays out `content`. `width` null is auto width: only newlines break lines. Otherwise lines
 * wrap at word boundaries within `width`, and words longer than a line break anywhere.
 */
export function layoutText(
  content: string,
  style: { fontSize: number; bold: boolean; width: number | null },
): TextLayout {
  const font = textFont(style.fontSize, style.bold)
  const key = `${font}|${style.width}|${content}`
  const cached = cache.get(key)
  if (cached) return cached

  const size = style.fontSize
  const fits = (text: string) =>
    style.width === null || measure(text.trimEnd(), font, size) <= style.width
  const lines: string[] = []
  for (const paragraph of content.split("\n")) {
    if (style.width === null) {
      lines.push(paragraph)
      continue
    }
    let line = ""
    for (const token of paragraph.match(/\S+|\s+/g) ?? []) {
      if (/^\s/.test(token) || fits(line + token)) {
        line += token // spaces always stay on the line they follow
        continue
      }
      if (line.trim() !== "") {
        lines.push(line)
        line = ""
      }
      if (fits(line + token)) {
        line += token
        continue
      }
      for (const char of token) {
        if (line.trim() !== "" && !fits(line + char)) {
          lines.push(line)
          line = ""
        }
        line += char
      }
    }
    lines.push(line)
  }

  const lineHeight = size * LINE_HEIGHT
  const measured = lines.map((text) => ({
    text,
    // Auto width counts trailing spaces (the textarea does); wrapped lines let them hang.
    width: measure(style.width === null ? text : text.trimEnd(), font, size),
  }))
  const layout: TextLayout = {
    lines: measured,
    width: Math.max(1, ...measured.map((l) => l.width)),
    height: Math.max(1, lines.length) * lineHeight,
    lineHeight,
    baseline: baselineOf(font, size, lineHeight),
  }
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, layout)
  return layout
}
