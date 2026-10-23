import type { ElementWithId, ImageElement, Point } from "@syncanvas/board-model"
import {
  absolutePoints,
  arrowShape,
  canvasColors,
  linePath,
  paletteShades,
  STICKY_PADDING,
  STICKY_TEXT_COLOR,
  stickyBackground,
  stickyLayoutOf,
  strokeOutline,
  strokeWidth,
  type Theme,
  textLayoutOf,
} from "./index"
import { TEXT_FONT_FAMILY, TEXT_SIZES } from "./text"

// SVG export (M6 ticket 02): a second backend that mirrors the Canvas2D drawing Element by
// Element (same palette, line widths, arrowheads, pen outlines, and text layout), so an SVG
// matches the screen and the PNG. Units are canvas units at 100%. No DOM needed.

export type SvgOptions = {
  theme: Theme
  /** An image Element's file as a data URL, or null to draw its placeholder. */
  imageData?: (e: ImageElement) => string | null
  /** `@font-face` rules embedding the fonts, so the file renders the same anywhere. */
  fontCss?: string
  /** Space around the Elements, in canvas units. */
  padding?: number
}

/** Lines are as thick as on screen at 100% (worked out on use: index.ts and this file import each other). */
const lineWidth = () => strokeWidth(1)

const n = (v: number) => {
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? "0" : String(r)
}

/** Escapes text for SVG content and attribute values. */
export function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

const polyline = (points: readonly Point[]) =>
  points.map((p, i) => `${i === 0 ? "M" : "L"}${n(p.x)} ${n(p.y)}`).join(" ")

/** One text line, positioned at its baseline. Spaces are kept as typed. */
function textLine(
  text: string,
  x: number,
  y: number,
  style: { size: number; bold: boolean; color: string },
) {
  return `<text x="${n(x)}" y="${n(y)}" font-family="${escapeXml(TEXT_FONT_FAMILY)}" font-size="${n(style.size)}" font-weight="${style.bold ? 600 : 400}" fill="${style.color}" xml:space="preserve">${escapeXml(text)}</text>`
}

function elementSvg(
  e: ElementWithId,
  byId: ReadonlyMap<string, ElementWithId>,
  options: SvgOptions,
  clipId: () => string,
): string {
  const { theme } = options
  if (e.type === "sticky") {
    const { layout, fontSize, height } = stickyLayoutOf(e)
    const { x, y } = e.position
    const w = e.size.w
    const clip = clipId()
    const lines = layout.lines.map((line, i) =>
      textLine(
        line.text,
        x + STICKY_PADDING,
        y + STICKY_PADDING + i * layout.lineHeight + layout.baseline,
        {
          size: fontSize,
          bold: e.bold,
          color: STICKY_TEXT_COLOR,
        },
      ),
    )
    return [
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(height)}" rx="4" fill="${stickyBackground(e.color, theme)}"/>`,
      `<clipPath id="${clip}"><rect x="${n(x)}" y="${n(y + STICKY_PADDING)}" width="${n(w)}" height="${n(height - STICKY_PADDING * 2)}"/></clipPath>`,
      `<g clip-path="url(#${clip})">${lines.join("")}</g>`,
    ].join("")
  }
  if (e.type === "image") {
    const data = options.imageData?.(e) ?? null
    const { x, y } = e.position
    if (!data) {
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(e.size.w)}" height="${n(e.size.h)}" fill="${canvasColors(theme).muted}"/>`
    }
    return `<image href="${escapeXml(data)}" x="${n(x)}" y="${n(y)}" width="${n(e.size.w)}" height="${n(e.size.h)}" preserveAspectRatio="none"/>`
  }
  const shades = paletteShades(e.color, theme)
  switch (e.type) {
    case "rect":
    case "ellipse": {
      const fill = e.fill === "none" ? "none" : e.fill === "solid" ? shades.stroke : shades.fill
      const paint = `fill="${fill}" stroke="${shades.stroke}" stroke-width="${n(lineWidth())}"`
      const { x, y } = e.position
      const { w, h } = e.size
      if (e.type === "ellipse") {
        return `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${paint}/>`
      }
      const r = Math.min(4, w / 2, h / 2)
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" ${paint}/>`
    }
    case "pen": {
      const outline = strokeOutline(absolutePoints(e), e.width)
      if (outline.length === 0) return ""
      const d = outline
        .map(([x = 0, y = 0], i) => `${i === 0 ? "M" : "L"}${n(x)} ${n(y)}`)
        .join(" ")
      return `<path d="${d} Z" fill="${shades.stroke}"/>`
    }
    case "arrow":
    case "connector": {
      const path = linePath(e, byId)
      const shape = path && arrowShape(path, lineWidth())
      if (!shape) return ""
      const stroke = `stroke="${shades.stroke}" stroke-width="${n(lineWidth())}" stroke-linecap="round" stroke-linejoin="round"`
      const line = `<path d="${polyline(shape.line)}" fill="none" ${stroke}/>`
      if (!shape.head) return line
      const head = `<path d="${polyline(shape.head)} Z" fill="${shades.stroke}" ${stroke}/>`
      return line + head
    }
    case "text": {
      const layout = textLayoutOf(e)
      const width = e.autoWidth ? layout.width : e.size.w
      return layout.lines
        .map((line, i) => {
          const offset =
            e.align === "center"
              ? (width - line.width) / 2
              : e.align === "right"
                ? width - line.width
                : 0
          return textLine(
            line.text,
            e.position.x + offset,
            e.position.y + i * layout.lineHeight + layout.baseline,
            { size: TEXT_SIZES[e.fontSize], bold: e.bold, color: shades.stroke },
          )
        })
        .join("")
    }
  }
}

/**
 * The Elements (in drawing order; `byId` holds every Element, for connector ends) as a
 * standalone SVG document framing `bounds` with `padding` around it, on the theme's canvas
 * background. One SVG unit is one canvas unit.
 */
export function toSvg(
  elements: readonly ElementWithId[],
  byId: ReadonlyMap<string, ElementWithId>,
  bounds: { x: number; y: number; w: number; h: number },
  options: SvgOptions,
): string {
  const padding = options.padding ?? 16
  const x = bounds.x - padding
  const y = bounds.y - padding
  const w = Math.max(1, bounds.w + padding * 2)
  const h = Math.max(1, bounds.h + padding * 2)
  let clips = 0
  const body = elements.map((e) => elementSvg(e, byId, options, () => `clip${++clips}`)).join("")
  const style = options.fontCss ? `<defs><style>${options.fontCss}</style></defs>` : ""
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" width="${n(w)}" height="${n(h)}">`,
    style,
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${canvasColors(options.theme).background}"/>`,
    body,
    "</svg>",
  ].join("")
}
