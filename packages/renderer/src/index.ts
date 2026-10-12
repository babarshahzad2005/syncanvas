import {
  type ElementWithId,
  type Fill,
  hasBox,
  indexById,
  type PaletteColor,
  type PenElement,
  type PenWidth,
  type Point,
  resolveConnector,
  type Size,
  type StickyColor,
  type StickyElement,
  type StickySize,
  type StrokePoint,
  type TextElement,
} from "@syncanvas/board-model"
import { getStroke } from "perfect-freehand"
import { layoutText, TEXT_SIZES, type TextLayout, textFont } from "./text"

export * from "./spatial"
export * from "./text"

// Canvas2D drawing shared by the screen (and later PNG export and thumbnails).
// No DOM access beyond the 2D context it's handed.

// ---------- Camera ----------

/** screen = world · zoom + offset. `offset` is in screen pixels. */
export type Camera = { x: number; y: number; zoom: number }

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

export function worldToScreen(camera: Camera, p: Point): Point {
  return { x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y }
}

export function screenToWorld(camera: Camera, p: Point): Point {
  return { x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom }
}

/** Zooms by `factor`, keeping the world point under `anchor` (screen px) fixed. */
export function zoomAt(camera: Camera, anchor: Point, factor: number): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor))
  const world = screenToWorld(camera, anchor)
  return { zoom, x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom }
}

/** A camera that fits `bounds` inside a `viewport` with some padding, capped at 100%. */
export function fitCamera(
  bounds: { x: number; y: number; w: number; h: number } | null,
  viewport: Size,
  padding = 80,
): Camera {
  if (!bounds || bounds.w === 0 || bounds.h === 0)
    return { x: viewport.w / 2, y: viewport.h / 2, zoom: 1 }
  const zoom = Math.min(
    1,
    Math.max(
      MIN_ZOOM,
      Math.min((viewport.w - padding * 2) / bounds.w, (viewport.h - padding * 2) / bounds.h),
    ),
  )
  return {
    zoom,
    x: viewport.w / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: viewport.h / 2 - (bounds.y + bounds.h / 2) * zoom,
  }
}

export function boundsOf(
  elements: readonly ElementWithId[],
  byId: ReadonlyMap<string, ElementWithId> = indexById(elements),
) {
  if (elements.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const e of elements) {
    const { position, size } = elementBox(e, byId)
    minX = Math.min(minX, position.x)
    minY = Math.min(minY, position.y)
    maxX = Math.max(maxX, position.x + size.w)
    maxY = Math.max(maxY, position.y + size.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// ---------- Dot grid (DESIGN.md → Canvas) ----------

/** Canvas units between grid dots at 100% zoom. */
export const GRID_SPACING = 24

/**
 * Dot-grid spacing and opacity for a zoom level: spacing doubles below 50%,
 * and the grid fades out between 50% and 25%.
 */
export function gridAt(zoom: number): { spacing: number; opacity: number } {
  const spacing = zoom < 0.5 ? GRID_SPACING * 2 : GRID_SPACING
  const opacity = zoom >= 0.5 ? 1 : zoom <= 0.25 ? 0 : (zoom - 0.25) / 0.25
  return { spacing, opacity }
}

// ---------- Theme (DESIGN.md palette + canvas colors) ----------

export type Theme = "light" | "dark"
type Shades = { stroke: string; fill: string }

const PALETTE: Record<PaletteColor, { light: Shades; dark: Shades }> = {
  ink: {
    light: { stroke: "#1C1B19", fill: "#E8E6E1" },
    dark: { stroke: "#EDEBE7", fill: "#3A3835" },
  },
  gray: {
    light: { stroke: "#7A766F", fill: "#EEECE8" },
    dark: { stroke: "#A8A49D", fill: "#2F2E2B" },
  },
  red: {
    light: { stroke: "#D2382D", fill: "#FDE2DF" },
    dark: { stroke: "#FF7B6F", fill: "#4A201C" },
  },
  orange: {
    light: { stroke: "#D2650C", fill: "#FFE7D1" },
    dark: { stroke: "#FFA35A", fill: "#4A2D13" },
  },
  yellow: {
    light: { stroke: "#A87F00", fill: "#FFF2BF" },
    dark: { stroke: "#F2CC4A", fill: "#433813" },
  },
  green: {
    light: { stroke: "#2B8A3E", fill: "#DCF2E0" },
    dark: { stroke: "#6BD48A", fill: "#183A22" },
  },
  teal: {
    light: { stroke: "#0C8579", fill: "#D4F2EE" },
    dark: { stroke: "#4FD1C2", fill: "#123630" },
  },
  blue: {
    light: { stroke: "#2A64DB", fill: "#DCE7FD" },
    dark: { stroke: "#7EA9FF", fill: "#182B4D" },
  },
  violet: {
    light: { stroke: "#7646D6", fill: "#ECE3FC" },
    dark: { stroke: "#B497FF", fill: "#2D204D" },
  },
  pink: {
    light: { stroke: "#C93A84", fill: "#FCE0EE" },
    dark: { stroke: "#FF86C3", fill: "#4A1B34" },
  },
}

/** Sticky note backgrounds (DESIGN.md `sticky`); the text on them is always ink. */
const STICKY: Record<StickyColor, { light: string; dark: string }> = {
  yellow: { light: "#FFE58A", dark: "#E6CF7A" },
  orange: { light: "#FFC99A", dark: "#E6B48A" },
  pink: { light: "#FFC2DD", dark: "#E6AEC6" },
  violet: { light: "#D9C8FF", dark: "#C3B4E6" },
  blue: { light: "#BFD9FF", dark: "#ABC3E6" },
  green: { light: "#C3EBC4", dark: "#AFD3B0" },
}
export const STICKY_TEXT_COLOR = "#1C1B19"

export function stickyBackground(color: StickyColor, theme: Theme): string {
  return STICKY[color][theme]
}

const CANVAS = {
  light: { background: "#F8F7F4", gridDot: "#D9D5CE", primary: "#5145CD", handleFill: "#FFFFFF" },
  dark: { background: "#161514", gridDot: "#45423D", primary: "#8C82F6", handleFill: "#FFFFFF" },
} as const

export function paletteShades(color: PaletteColor, theme: Theme): Shades {
  return PALETTE[color][theme]
}

// ---------- Hit testing ----------

/** Distance from `p` to the segment a–b. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * The topmost Element under a world point, with a small screen-space tolerance. `elements`
 * may be just the candidates near the point (in drawing order); `byId` must then hold every
 * Element, so connectors can find what they attach to.
 */
export function hitTest(
  elements: readonly ElementWithId[],
  world: Point,
  zoom: number,
  byId: ReadonlyMap<string, ElementWithId> = indexById(elements),
): string | null {
  const tolerance = 4 / zoom
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i]
    if (!e) continue
    const line = lineEnds(e, byId)
    if (line) {
      if (distanceToSegment(world, line.from, line.to) <= tolerance + strokeWidth(zoom) / 2) {
        return e.id
      }
      continue
    }
    if (!hasBox(e)) continue
    if (e.type === "pen") {
      // Along the stroke itself, not its box.
      const reach = tolerance + PEN_WIDTHS[e.width] / 2
      const points = absolutePoints(e)
      for (let j = 0; j < points.length; j++) {
        const a = points[j] as StrokePoint
        const b = points[j + 1] ?? a
        const d = distanceToSegment(world, { x: a[0], y: a[1] }, { x: b[0], y: b[1] })
        if (d <= reach) return e.id
      }
      continue
    }
    if (e.type === "ellipse") {
      // Inside the ellipse grown by the tolerance on each axis.
      const rx = e.size.w / 2 + tolerance
      const ry = e.size.h / 2 + tolerance
      const dx = world.x - (e.position.x + e.size.w / 2)
      const dy = world.y - (e.position.y + e.size.h / 2)
      if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) return e.id
      continue
    }
    const size = e.type === "text" ? textSize(e) : e.type === "sticky" ? stickySize(e) : e.size
    if (
      world.x >= e.position.x - tolerance &&
      world.x <= e.position.x + size.w + tolerance &&
      world.y >= e.position.y - tolerance &&
      world.y <= e.position.y + size.h + tolerance
    ) {
      return e.id
    }
  }
  return null
}

// ---------- Drawing ----------

export type Scene = {
  /** What to draw, in drawing order: the whole Board, or just what's near the viewport. */
  elements: readonly ElementWithId[]
  /** Every Element by id (connectors look up their ends here); defaults to `elements`. */
  byId?: ReadonlyMap<string, ElementWithId>
  camera: Camera
  theme: Theme
  /** CSS pixel size of the canvas. */
  size: Size
  dpr: number
  selection: ReadonlySet<string>
  /** Elements overriding the document while a local move or resize is in progress. */
  overrides?: ReadonlyMap<string, ElementWithId>
  /** What's being drawn right now, in world coordinates (not yet in the document). */
  preview?:
    | { type: "rect" | "ellipse"; position: Point; size: Size; color: PaletteColor; fill: Fill }
    | { type: "pen"; points: readonly StrokePoint[]; color: PaletteColor; width: PenWidth }
    | { type: "arrow"; from: Point; to: Point; color: PaletteColor }
    | null
  showGrid?: boolean
  /** The marquee being dragged, in world coordinates. */
  marquee?: { position: Point; size: Size } | null
  /** The text or sticky being edited in the textarea overlay: its text isn't drawn on the canvas. */
  editing?: string | null
}

export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { camera, theme, size, dpr } = scene
  const colors = CANVAS[theme]

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = colors.background
  ctx.fillRect(0, 0, size.w, size.h)

  if (scene.showGrid !== false) drawGrid(ctx, camera, size, colors.gridDot)

  ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.x, dpr * camera.y)
  // Apply local drags first, so connectors follow the shapes being dragged.
  const overrides = scene.overrides
  const elements = overrides?.size
    ? scene.elements.map((e) => overrides.get(e.id) ?? e)
    : scene.elements
  let byId: ReadonlyMap<string, ElementWithId> = scene.byId ?? indexById(scene.elements)
  if (overrides?.size) {
    const copy = new Map(byId)
    for (const [id, e] of overrides) if (copy.has(id)) copy.set(id, e)
    byId = copy
  }
  for (const e of elements) {
    if (e.id === scene.editing && e.type === "text") continue // the textarea shows it
    drawElement(ctx, e, byId, theme, camera.zoom, e.id === scene.editing)
  }
  if (scene.preview?.type === "arrow") {
    const p = scene.preview
    drawArrow(ctx, p.from, p.to, paletteShades(p.color, theme).stroke, camera.zoom)
  } else if (scene.preview?.type === "pen") {
    const p = scene.preview
    drawStroke(ctx, p.points, p.width, paletteShades(p.color, theme).stroke, false)
  } else if (scene.preview) {
    const p = scene.preview
    const position = {
      x: p.size.w < 0 ? p.position.x + p.size.w : p.position.x,
      y: p.size.h < 0 ? p.position.y + p.size.h : p.position.y,
    }
    const size = { w: Math.abs(p.size.w), h: Math.abs(p.size.h) }
    const shades = paletteShades(p.color, theme)
    if (p.type === "ellipse") drawEllipse(ctx, position, size, p.fill, shades, camera.zoom)
    else drawRect(ctx, position, size, p.fill, shades, camera.zoom)
  }

  // Selection chrome is drawn in screen space so handles keep a constant size at any zoom.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const toScreen = (box: { position: Point; size: Size }) => ({
    p: worldToScreen(camera, box.position),
    s: { w: box.size.w * camera.zoom, h: box.size.h * camera.zoom },
  })
  const selected = [...scene.selection].flatMap((id) => {
    const e = byId.get(id)
    return e ? [e] : []
  })
  if (selected.length > 1) {
    // Each member gets a thin outline; the selection as a whole gets the box and handles.
    ctx.lineWidth = 1
    ctx.strokeStyle = colors.primary
    for (const e of selected) {
      const line = lineEnds(e, byId)
      if (line) {
        const from = worldToScreen(camera, line.from)
        const to = worldToScreen(camera, line.to)
        ctx.beginPath()
        ctx.moveTo(from.x, from.y)
        ctx.lineTo(to.x, to.y)
        ctx.stroke()
        continue
      }
      const { p, s } = toScreen(elementBox(e, byId))
      ctx.strokeRect(p.x, p.y, s.w, s.h)
    }
  }
  const frame = selectionFrame(selected, byId)
  if (frame?.kind === "ends") {
    // A single line shows its two ends, not a box.
    drawHandles(ctx, [worldToScreen(camera, frame.from), worldToScreen(camera, frame.to)], colors)
  } else if (frame) {
    const { p, s } = toScreen({
      position: { x: frame.rect.x, y: frame.rect.y },
      size: { w: frame.rect.w, h: frame.rect.h },
    })
    drawSelection(ctx, p, s, colors)
  }

  if (scene.marquee) {
    const { p, s } = toScreen(scene.marquee)
    const x = Math.min(p.x, p.x + s.w)
    const y = Math.min(p.y, p.y + s.h)
    ctx.fillStyle = colors.primary
    ctx.globalAlpha = 0.08
    ctx.fillRect(x, y, Math.abs(s.w), Math.abs(s.h))
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
    ctx.strokeStyle = colors.primary
    ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(s.w), Math.abs(s.h))
  }
}

/**
 * Where the selection's handles are: a single line's two ends, or the box around the
 * selection (whose corners resize it). Null for an empty selection.
 */
export function selectionFrame(
  selected: readonly ElementWithId[],
  byId: ReadonlyMap<string, ElementWithId>,
):
  | { kind: "ends"; id: string; from: Point; to: Point }
  | { kind: "box"; rect: { x: number; y: number; w: number; h: number } }
  | null {
  const [only] = selected
  if (!only) return null
  if (selected.length === 1) {
    const line = lineEnds(only, byId)
    if (line) return { kind: "ends", id: only.id, ...line }
  }
  const rect = boundsOf(selected, byId)
  return rect ? { kind: "box", rect } : null
}

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, color: string) {
  const { spacing, opacity } = gridAt(camera.zoom)
  if (opacity === 0) return
  const step = spacing * camera.zoom
  const startX = ((camera.x % step) + step) % step
  const startY = ((camera.y % step) + step) % step
  ctx.globalAlpha = opacity
  ctx.fillStyle = color
  for (let x = startX; x < size.w; x += step) {
    for (let y = startY; y < size.h; y += step) ctx.fillRect(x - 0.5, y - 0.5, 1, 1)
  }
  ctx.globalAlpha = 1
}

/** An Element's box in world coordinates; for a connector, the box around its resolved ends. */
export function elementBox(
  e: ElementWithId,
  byId: ReadonlyMap<string, ElementWithId>,
): { position: Point; size: Size } {
  if (e.type === "text") return { position: e.position, size: textSize(e) }
  if (e.type === "sticky") return { position: e.position, size: stickySize(e) }
  if (hasBox(e)) return { position: e.position, size: e.size }
  const { start, end } = resolveConnector(e, byId)
  return {
    position: { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
    size: { w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) },
  }
}

// ---------- Text ----------

/** A text Element's layout: auto width lays out unwrapped, otherwise it wraps at `size.w`. */
export function textLayoutOf(e: TextElement): TextLayout {
  return layoutText(e.text, {
    fontSize: TEXT_SIZES[e.fontSize],
    bold: e.bold,
    width: e.autoWidth ? null : e.size.w,
  })
}

/** The box a text Element really covers: its layout height, and its width when auto. */
export function textSize(e: TextElement): Size {
  const layout = textLayoutOf(e)
  return { w: e.autoWidth ? layout.width : e.size.w, h: layout.height }
}

function drawText(ctx: CanvasRenderingContext2D, e: TextElement, color: string) {
  const layout = textLayoutOf(e)
  const width = e.autoWidth ? layout.width : e.size.w
  ctx.font = textFont(TEXT_SIZES[e.fontSize], e.bold)
  ctx.fillStyle = color
  ctx.textBaseline = "alphabetic"
  for (const [i, line] of layout.lines.entries()) {
    const offset =
      e.align === "center" ? (width - line.width) / 2 : e.align === "right" ? width - line.width : 0
    ctx.fillText(
      line.text,
      e.position.x + offset,
      e.position.y + i * layout.lineHeight + layout.baseline,
    )
  }
}

// ---------- Sticky notes ----------

/** Sticky font sizes in canvas units (DESIGN.md typography.canvas.sticky). */
export const STICKY_TEXT_SIZES: Record<StickySize, number> = { S: 14, M: 16, L: 20 }
/** Sticky text shrinks down to this size once the note can't grow any taller. */
export const STICKY_MIN_FONT = 10
/** Space between a sticky note's edge and its text, in canvas units. */
export const STICKY_PADDING = 16

export type StickyLayout = {
  layout: TextLayout
  /** The font size actually used: the chosen size, or smaller once the note is full. */
  fontSize: number
  /** The note's drawn height: from its width (square) up to twice that. */
  height: number
  /** True when even the smallest font overflows: the text is cut off at the bottom. */
  clipped: boolean
}

/**
 * Lays out a sticky note (spec: fixed width, height grows with content up to a maximum,
 * then the text shrinks). Like text, this is derived from the content at render time, so
 * concurrent typing never leaves a stale height.
 */
export function stickyLayoutOf(e: StickyElement): StickyLayout {
  const width = e.size.w
  const inner = Math.max(1, width - STICKY_PADDING * 2)
  const maxHeight = width * 2
  const chosen = STICKY_TEXT_SIZES[e.fontSize]
  let fontSize = chosen
  let layout = layoutText(e.text, { fontSize, bold: e.bold, width: inner })
  while (layout.height + STICKY_PADDING * 2 > maxHeight && fontSize > STICKY_MIN_FONT) {
    fontSize--
    layout = layoutText(e.text, { fontSize, bold: e.bold, width: inner })
  }
  const needed = layout.height + STICKY_PADDING * 2
  return {
    layout,
    fontSize,
    height: Math.min(maxHeight, Math.max(width, needed)),
    clipped: needed > maxHeight,
  }
}

/** The box a sticky note really covers. */
export function stickySize(e: StickyElement): Size {
  return { w: e.size.w, h: stickyLayoutOf(e).height }
}

function drawSticky(
  ctx: CanvasRenderingContext2D,
  e: StickyElement,
  theme: Theme,
  editing: boolean,
) {
  const { layout, fontSize, height } = stickyLayoutOf(e)
  const { x, y } = e.position
  const w = e.size.w
  ctx.beginPath()
  ctx.roundRect(x, y, w, height, 4)
  ctx.fillStyle = stickyBackground(e.color, theme)
  ctx.fill()
  if (editing) return // the textarea shows the text
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y + STICKY_PADDING, w, height - STICKY_PADDING * 2)
  ctx.clip()
  ctx.font = textFont(fontSize, e.bold)
  ctx.fillStyle = STICKY_TEXT_COLOR
  ctx.textBaseline = "alphabetic"
  for (const [i, line] of layout.lines.entries()) {
    ctx.fillText(
      line.text,
      x + STICKY_PADDING,
      y + STICKY_PADDING + i * layout.lineHeight + layout.baseline,
    )
  }
  ctx.restore()
}

/** Line width that stays legible when zoomed out. */
const strokeWidth = (zoom: number) => 2 / Math.max(zoom, 0.5)

// Every type is drawn at least as a placeholder, so a Board never fails to draw a type a
// later ticket finishes (connector elbows are still to come).
function drawElement(
  ctx: CanvasRenderingContext2D,
  e: ElementWithId,
  byId: ReadonlyMap<string, ElementWithId>,
  theme: Theme,
  zoom: number,
  editing: boolean,
) {
  if (e.type === "sticky") {
    drawSticky(ctx, e, theme, editing)
    return
  }
  const shades = paletteShades(e.color, theme)
  switch (e.type) {
    case "rect":
      drawRect(ctx, e.position, e.size, e.fill, shades, zoom)
      return
    case "ellipse":
      drawEllipse(ctx, e.position, e.size, e.fill, shades, zoom)
      return
    case "pen":
      drawStroke(ctx, absolutePoints(e), e.width, shades.stroke, true)
      return
    case "arrow":
    case "connector": {
      const line = lineEnds(e, byId)
      if (line) drawArrow(ctx, line.from, line.to, shades.stroke, zoom)
      return
    }
    case "text":
      drawText(ctx, e, shades.stroke)
      return
  }
}

// ---------- Arrows and connectors ----------

/** Where a line-like Element starts and ends right now (world), or null for other types. */
export function lineEnds(
  e: ElementWithId,
  byId: ReadonlyMap<string, ElementWithId>,
): { from: Point; to: Point } | null {
  if (e.type === "arrow") {
    return {
      from: { x: e.position.x + e.ends.from.x, y: e.position.y + e.ends.from.y },
      to: { x: e.position.x + e.ends.to.x, y: e.position.y + e.ends.to.y },
    }
  }
  if (e.type === "connector") {
    const { start, end } = resolveConnector(e, byId)
    return { from: start, to: end }
  }
  return null
}

/** Arrowhead: a filled triangle about 5 line widths long, half-angle ~26°. */
const ARROWHEAD_LENGTH = 5
const ARROWHEAD_ANGLE = 0.45

/** A straight line with a filled arrowhead at `to`. */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  color: string,
  zoom: number,
) {
  const width = strokeWidth(zoom)
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  // Short arrows get a smaller head, so the head never swallows the line.
  const head = Math.min(width * ARROWHEAD_LENGTH, length / 2)
  const base = {
    x: to.x - Math.cos(angle) * head * Math.cos(ARROWHEAD_ANGLE),
    y: to.y - Math.sin(angle) * head * Math.cos(ARROWHEAD_ANGLE),
  }
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(base.x, base.y)
  ctx.lineWidth = width
  ctx.lineCap = "round"
  ctx.strokeStyle = color
  ctx.stroke()
  if (head <= 0) return
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(
    to.x - head * Math.cos(angle - ARROWHEAD_ANGLE),
    to.y - head * Math.sin(angle - ARROWHEAD_ANGLE),
  )
  ctx.lineTo(
    to.x - head * Math.cos(angle + ARROWHEAD_ANGLE),
    to.y - head * Math.sin(angle + ARROWHEAD_ANGLE),
  )
  ctx.closePath()
  ctx.fillStyle = color
  ctx.lineJoin = "round"
  ctx.fill()
  ctx.stroke()
}

// ---------- Pen strokes ----------

/** Stroke widths in world units (DESIGN.md → Canvas). */
export const PEN_WIDTHS: Record<PenWidth, number> = { S: 2, M: 4, L: 8 }

function absolutePoints(e: PenElement): StrokePoint[] {
  return e.points.map(([x, y, pressure]) => [e.position.x + x, e.position.y + y, pressure])
}

/**
 * Draws a stroke as a filled perfect-freehand outline. Pressure always comes from the
 * points: a mouse or finger records a constant 0.5, which gives a constant width.
 */
function drawStroke(
  ctx: CanvasRenderingContext2D,
  points: readonly StrokePoint[],
  width: PenWidth,
  color: string,
  complete: boolean,
) {
  const outline = getStroke(points as StrokePoint[], {
    size: PEN_WIDTHS[width],
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: false,
    last: complete,
  })
  const [first, ...rest] = outline
  if (!first) return
  ctx.beginPath()
  ctx.moveTo(first[0] ?? 0, first[1] ?? 0)
  for (const [x = 0, y = 0] of rest) ctx.lineTo(x, y)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

/** Shape fill (DESIGN.md → Palette colors): none, the light fill shade, or the solid stroke shade. */
function fillShape(ctx: CanvasRenderingContext2D, fill: Fill, shades: Shades, zoom: number) {
  if (fill !== "none") {
    ctx.fillStyle = fill === "solid" ? shades.stroke : shades.fill
    ctx.fill()
  }
  ctx.lineWidth = strokeWidth(zoom)
  ctx.strokeStyle = shades.stroke
  ctx.stroke()
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  p: Point,
  s: Size,
  fill: Fill,
  shades: Shades,
  zoom: number,
) {
  ctx.beginPath()
  ctx.roundRect(p.x, p.y, s.w, s.h, Math.min(4, s.w / 2, s.h / 2))
  fillShape(ctx, fill, shades, zoom)
}

function drawEllipse(
  ctx: CanvasRenderingContext2D,
  p: Point,
  s: Size,
  fill: Fill,
  shades: Shades,
  zoom: number,
) {
  ctx.beginPath()
  ctx.ellipse(p.x + s.w / 2, p.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2)
  fillShape(ctx, fill, shades, zoom)
}

function drawHandles(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  colors: (typeof CANVAS)[Theme],
) {
  const half = 4
  ctx.lineWidth = 1.5
  ctx.strokeStyle = colors.primary
  for (const { x, y } of points) {
    ctx.beginPath()
    ctx.roundRect(x - half, y - half, half * 2, half * 2, 2)
    ctx.fillStyle = colors.handleFill
    ctx.fill()
    ctx.stroke()
  }
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  p: Point,
  s: Size,
  colors: (typeof CANVAS)[Theme],
) {
  ctx.lineWidth = 1.5
  ctx.strokeStyle = colors.primary
  ctx.strokeRect(p.x, p.y, s.w, s.h)
  drawHandles(
    ctx,
    [
      { x: p.x, y: p.y },
      { x: p.x + s.w, y: p.y },
      { x: p.x, y: p.y + s.h },
      { x: p.x + s.w, y: p.y + s.h },
    ],
    colors,
  )
}
