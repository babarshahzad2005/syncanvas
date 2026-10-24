import {
  type Anchor,
  type AttachBox,
  anchorPoint,
  attachedTarget,
  type ConnectorStyle,
  type ElementWithId,
  type Fill,
  hasBox,
  type ImageElement,
  indexById,
  isAttachable,
  type PaletteColor,
  type PenElement,
  type PenWidth,
  type Point,
  resolveConnector,
  resolveConnectorEnd,
  type Size,
  type StickyColor,
  type StickyElement,
  type StickySize,
  type StrokePoint,
  type TextElement,
} from "@syncanvas/board-model"
import { getStroke } from "perfect-freehand"
import { layoutText, TEXT_FONT_FAMILY, TEXT_SIZES, type TextLayout, textFont } from "./text"

export * from "./spatial"
export * from "./svg"
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
  light: {
    background: "#F8F7F4",
    gridDot: "#D9D5CE",
    primary: "#5145CD",
    handleFill: "#FFFFFF",
    // The lock badge uses the chrome's surface, border, and muted-foreground.
    surface: "#FFFFFF",
    border: "#E6E3DD",
    mutedForeground: "#6B6760",
    // Image placeholders (DESIGN.md → Images).
    muted: "#F2F0EC",
  },
  dark: {
    background: "#161514",
    gridDot: "#45423D",
    primary: "#8C82F6",
    handleFill: "#FFFFFF",
    surface: "#1F1E1C",
    border: "#3A3834",
    mutedForeground: "#A39F98",
    muted: "#2A2926",
  },
} as const

/** The canvas's own colors for a theme: its background, and the image placeholder's. */
export function canvasColors(theme: Theme): { background: string; muted: string } {
  return { background: CANVAS[theme].background, muted: CANVAS[theme].muted }
}

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
    const path = linePath(e, byId)
    if (path) {
      const reach = tolerance + strokeWidth(zoom) / 2
      for (let j = 1; j < path.length; j++) {
        if (distanceToSegment(world, path[j - 1] as Point, path[j] as Point) <= reach) return e.id
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

/**
 * An image file as the canvas has it (M5b ticket 03): decoded and ready, still on its way
 * (a placeholder with a spinner), or given up on (a placeholder alone).
 */
export type ImageState = { bitmap: CanvasImageSource } | "loading" | "missing"
/** Looks up (and, the first time, starts loading) the file behind an image Element. */
export type ImageSource = (e: ImageElement) => ImageState

/** An image being added in this tab: not in the document until its upload finishes. */
export type UploadPlaceholder = { position: Point; size: Size; failed: boolean }

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
    | {
        type: "connector"
        start: Point
        startAnchor?: Anchor
        end: Point
        endAnchor?: Anchor
        style: ConnectorStyle
        color: PaletteColor
      }
    | null
  showGrid?: boolean
  /** Snap points shown while drawing or re-attaching a connector; `active` is where it snaps. */
  snap?: { points: readonly Point[]; active: Point | null } | null
  /** A locked Element under the pointer: it shows its lock badge. */
  lockBadge?: string | null
  /**
   * What other people (and your own other tabs) have selected: outlined in their presence
   * color with their name. `ids` for a normal selection, `box` (world) for a large one.
   */
  remoteSelections?: readonly RemoteSelection[]
  /** False hides the selection's resize handles (a locked selection can't be resized). */
  handles?: boolean
  /** The marquee being dragged, in world coordinates. */
  marquee?: { position: Point; size: Size } | null
  /** The text or sticky being edited in the textarea overlay: its text isn't drawn on the canvas. */
  editing?: string | null
  /** Image files; without it, images draw as placeholders. */
  images?: ImageSource
  /** Images being uploaded from this tab, drawn as placeholders. */
  uploads?: readonly UploadPlaceholder[]
  /** Milliseconds (any clock): turns the placeholders' spinners. */
  time?: number
  /**
   * The zoom line widths are worked out for, if not the camera's. Pictures use 1, so lines
   * are as thick (relative to the Elements) as on screen at 100%, at any picture scale.
   */
  lineZoom?: number
  /**
   * Screen only: text too small to read is drawn as bars (DESIGN.md → Canvas → Zoomed out).
   * Pictures leave it off, so they keep full detail.
   */
  simplify?: boolean
}

/**
 * Draws a whole frame. Returns true while something on it is animating (a placeholder's
 * spinner), so the caller draws again on the next frame.
 */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): boolean {
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
  const paint: Paint = { images: scene.images, time: scene.time ?? 0, busy: false }
  const lineZoom = scene.lineZoom ?? camera.zoom
  // Simplifying: the zoom detail decisions are made at (null: full detail).
  const detailZoom = scene.simplify ? camera.zoom : null
  for (const e of elements) {
    if (e.id === scene.editing && e.type === "text") continue // the textarea shows it
    drawElement(ctx, e, byId, theme, lineZoom, e.id === scene.editing, paint, detailZoom)
  }
  for (const upload of scene.uploads ?? []) {
    drawPlaceholder(ctx, upload.position, upload.size, theme, camera.zoom, paint, !upload.failed)
  }
  if (scene.preview?.type === "arrow") {
    const p = scene.preview
    drawArrow(ctx, [p.from, p.to], paletteShades(p.color, theme).stroke, camera.zoom)
  } else if (scene.preview?.type === "connector") {
    const p = scene.preview
    const path = connectorPath(p.start, p.startAnchor, p.end, p.endAnchor, p.style)
    drawArrow(ctx, path, paletteShades(p.color, theme).stroke, camera.zoom)
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
  for (const remote of scene.remoteSelections ?? []) {
    drawRemoteSelection(ctx, remote, byId, camera)
  }
  const selected = [...scene.selection].flatMap((id) => {
    const e = byId.get(id)
    return e ? [e] : []
  })
  if (selected.length > 1) {
    // Each member gets a thin outline; the selection as a whole gets the box and handles.
    ctx.lineWidth = 1
    ctx.strokeStyle = colors.primary
    for (const e of selected) {
      const path = linePath(e, byId)
      if (path) {
        ctx.beginPath()
        for (const [j, p] of path.entries()) {
          const q = worldToScreen(camera, p)
          if (j === 0) ctx.moveTo(q.x, q.y)
          else ctx.lineTo(q.x, q.y)
        }
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
    drawSelection(ctx, p, s, colors, scene.handles !== false)
  }

  if (scene.snap) drawSnapPoints(ctx, scene.snap, camera, colors)

  const locked = scene.lockBadge ? byId.get(scene.lockBadge) : undefined
  if (locked) drawLockBadge(ctx, lockBadgeRect(locked, byId, camera), colors)

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
  return paint.busy
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
  const path = linePath(e, byId) ?? []
  const xs = path.map((p) => p.x)
  const ys = path.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { position: { x, y }, size: { w: Math.max(...xs) - x, h: Math.max(...ys) - y } }
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

/** Below this on-screen font size (px), text is drawn as bars when simplifying. */
export const TEXT_BARS_BELOW_PX = 4

/** True when text of `fontSize` (canvas units) is too small to read at `zoom`. */
export function textAsBars(fontSize: number, zoom: number | null): boolean {
  return zoom !== null && fontSize * zoom < TEXT_BARS_BELOW_PX
}

/** True when a corner of `radius` (canvas units) is under 1px on screen, so it's drawn square. */
export function squareCorners(radius: number, zoom: number | null): boolean {
  return zoom !== null && radius * zoom < 1
}

/** A rectangle path, its corners rounded unless they'd be too small to see. */
function boxPath(
  ctx: CanvasRenderingContext2D,
  p: Point,
  s: Size,
  radius: number,
  zoom: number | null,
) {
  ctx.beginPath()
  if (squareCorners(radius, zoom)) ctx.rect(p.x, p.y, s.w, s.h)
  else ctx.roundRect(p.x, p.y, s.w, s.h, radius)
}

/**
 * Text too small to read, as one soft bar per line (DESIGN.md → Canvas → Zoomed out). Lines
 * whose bottom is past `bottom` are left out, as clipping would.
 */
function drawTextBars(
  ctx: CanvasRenderingContext2D,
  layout: TextLayout,
  left: (lineWidth: number) => number,
  top: number,
  color: string,
  bottom = Number.POSITIVE_INFINITY,
) {
  ctx.fillStyle = color
  ctx.globalAlpha = 0.35
  const h = layout.lineHeight * 0.4
  for (const [i, line] of layout.lines.entries()) {
    const y = top + i * layout.lineHeight + (layout.lineHeight - h) / 2
    if (y + h > bottom) break
    if (line.width > 0) ctx.fillRect(left(line.width), y, line.width, h)
  }
  ctx.globalAlpha = 1
}

function drawText(
  ctx: CanvasRenderingContext2D,
  e: TextElement,
  color: string,
  detailZoom: number | null,
) {
  const layout = textLayoutOf(e)
  const width = e.autoWidth ? layout.width : e.size.w
  if (textAsBars(TEXT_SIZES[e.fontSize], detailZoom)) {
    const left = (w: number) =>
      e.position.x + (e.align === "center" ? (width - w) / 2 : e.align === "right" ? width - w : 0)
    drawTextBars(ctx, layout, left, e.position.y, color)
    return
  }
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
  detailZoom: number | null,
) {
  const { layout, fontSize, height } = stickyLayoutOf(e)
  const { x, y } = e.position
  const w = e.size.w
  boxPath(ctx, e.position, { w, h: height }, 4, detailZoom)
  ctx.fillStyle = stickyBackground(e.color, theme)
  ctx.fill()
  if (editing) return // the textarea shows the text
  if (textAsBars(fontSize, detailZoom)) {
    const top = y + STICKY_PADDING
    const bottom = y + height - STICKY_PADDING
    drawTextBars(ctx, layout, () => x + STICKY_PADDING, top, STICKY_TEXT_COLOR, bottom)
    return
  }
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
export const strokeWidth = (zoom: number) => 2 / Math.max(zoom, 0.5)

// Every type is drawn at least as a placeholder, so a Board never fails to draw a type a
// later ticket finishes (connector elbows are still to come).
function drawElement(
  ctx: CanvasRenderingContext2D,
  e: ElementWithId,
  byId: ReadonlyMap<string, ElementWithId>,
  theme: Theme,
  zoom: number,
  editing: boolean,
  paint: Paint,
  detailZoom: number | null = null,
) {
  if (e.type === "sticky") {
    drawSticky(ctx, e, theme, editing, detailZoom)
    return
  }
  if (e.type === "image") {
    const state = paint.images?.(e) ?? "missing"
    if (typeof state === "object") {
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(state.bitmap, e.position.x, e.position.y, e.size.w, e.size.h)
    } else {
      drawPlaceholder(ctx, e.position, e.size, theme, zoom, paint, state === "loading")
    }
    return
  }
  const shades = paletteShades(e.color, theme)
  switch (e.type) {
    case "rect":
      drawRect(ctx, e.position, e.size, e.fill, shades, zoom, detailZoom)
      return
    case "ellipse":
      drawEllipse(ctx, e.position, e.size, e.fill, shades, zoom)
      return
    case "pen":
      if (sketchPen(e, detailZoom)) drawPenSketch(ctx, e, shades.stroke, detailZoom ?? 1)
      else fillOutline(ctx, penOutline(e), shades.stroke)
      return
    case "arrow":
    case "connector": {
      const path = linePath(e, byId)
      if (path) drawArrow(ctx, path, shades.stroke, zoom)
      return
    }
    case "text":
      drawText(ctx, e, shades.stroke, detailZoom)
      return
  }
}

// ---------- Image placeholders (DESIGN.md → Images) ----------

/** What drawing a frame shares: image files, the clock, and whether anything is animating. */
type Paint = { images: ImageSource | undefined; time: number; busy: boolean }

/** One turn of the spinner, in milliseconds. */
const SPIN_MS = 800

/** A `muted` box where an image will be, with a small spinner while it's on its way. */
function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  position: Point,
  size: Size,
  theme: Theme,
  zoom: number,
  paint: Paint,
  spinning: boolean,
) {
  const colors = CANVAS[theme]
  ctx.fillStyle = colors.muted
  ctx.fillRect(position.x, position.y, size.w, size.h)
  if (!spinning) return
  paint.busy = true
  // 8 screen px across at any zoom, but never bigger than the box.
  const radius = Math.min(8 / zoom, size.w / 4, size.h / 4)
  if (radius <= 0) return
  const start = ((paint.time % SPIN_MS) / SPIN_MS) * Math.PI * 2
  ctx.beginPath()
  ctx.arc(position.x + size.w / 2, position.y + size.h / 2, radius, start, start + Math.PI * 1.5)
  ctx.strokeStyle = colors.mutedForeground
  ctx.lineWidth = Math.min(2 / zoom, radius / 2)
  ctx.lineCap = "round"
  ctx.stroke()
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
    const { start, end } = connectorEnds(e, byId)
    return { from: start, to: end }
  }
  return null
}

/** Arrowhead: a filled triangle about 5 line widths long, half-angle ~26°. */
const ARROWHEAD_LENGTH = 5
const ARROWHEAD_ANGLE = 0.45

/**
 * An arrow's shape for a line of `width` through `points`: the line (ending where the head
 * begins) and the head's three corners (null when there's no room for one). Shared by the
 * canvas and SVG, so both draw the same arrow.
 */
export function arrowShape(
  points: readonly Point[],
  width: number,
): { line: Point[]; head: [Point, Point, Point] | null } | null {
  const to = points.at(-1)
  const from = points.at(-2)
  if (!to || !from) return null
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  // Short last segments get a smaller head, so the head never swallows the line.
  const head = Math.min(width * ARROWHEAD_LENGTH, length / 2)
  const base = {
    x: to.x - Math.cos(angle) * head * Math.cos(ARROWHEAD_ANGLE),
    y: to.y - Math.sin(angle) * head * Math.cos(ARROWHEAD_ANGLE),
  }
  const line = [...points.slice(0, -1), base]
  if (head <= 0) return { line, head: null }
  return {
    line,
    head: [
      to,
      {
        x: to.x - head * Math.cos(angle - ARROWHEAD_ANGLE),
        y: to.y - head * Math.sin(angle - ARROWHEAD_ANGLE),
      },
      {
        x: to.x - head * Math.cos(angle + ARROWHEAD_ANGLE),
        y: to.y - head * Math.sin(angle + ARROWHEAD_ANGLE),
      },
    ],
  }
}

/** A line through `points` with a filled arrowhead at the last point. */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  color: string,
  zoom: number,
) {
  const width = strokeWidth(zoom)
  const shape = arrowShape(points, width)
  if (!shape) return
  ctx.beginPath()
  for (const [i, p] of shape.line.entries()) {
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
  ctx.lineWidth = width
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.strokeStyle = color
  ctx.stroke()
  if (!shape.head) return
  const [tip, left, right] = shape.head
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(left.x, left.y)
  ctx.lineTo(right.x, right.y)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.stroke()
}

// ---------- Connector routing (spec: Connectors) ----------

const ANCHOR_DIRECTIONS: Record<Anchor, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

/**
 * The path of a connector: a straight line, or an elbow of 2–3 orthogonal segments (no
 * obstacle avoidance, PRD). An attached end leaves its side perpendicularly; a free end
 * goes along whichever axis covers more distance.
 */
export function connectorPath(
  start: Point,
  startAnchor: Anchor | undefined,
  end: Point,
  endAnchor: Anchor | undefined,
  style: ConnectorStyle,
): Point[] {
  if (style === "straight") return [start, end]
  const dx = end.x - start.x
  const dy = end.y - start.y
  const free = Math.abs(dx) >= Math.abs(dy) ? "h" : "v"
  const axis = (a: Anchor | undefined) => (a ? (ANCHOR_DIRECTIONS[a].x !== 0 ? "h" : "v") : free)
  const from = axis(startAnchor)
  const to = axis(endAnchor)
  let points: Point[]
  if (from === "h" && to === "h") {
    const midX = start.x + dx / 2
    points = [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]
  } else if (from === "v" && to === "v") {
    const midY = start.y + dy / 2
    points = [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]
  } else if (from === "h") {
    points = [start, { x: end.x, y: start.y }, end]
  } else {
    points = [start, { x: start.x, y: end.y }, end]
  }
  // Aligned ends make some segments zero-length or straight continuations: drop those points,
  // so the arrowhead keeps a direction and a level elbow is one segment.
  const out: Point[] = []
  for (const p of points) {
    const last = out.at(-1)
    if (last && last.x === p.x && last.y === p.y) continue
    const before = out.at(-2)
    if (
      last &&
      before &&
      ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))
    ) {
      out[out.length - 1] = p
      continue
    }
    out.push(p)
  }
  return out
}

/** The box connectors attach to: the drawn box (text and sticky boxes come from layout). */
const attachBox: AttachBox = (e) => {
  if (!hasBox(e)) return null
  if (e.type === "text") return { position: e.position, size: textSize(e) }
  if (e.type === "sticky") return { position: e.position, size: stickySize(e) }
  return { position: e.position, size: e.size }
}

/** The four side midpoints a connector end can snap to on an Element. */
export function snapPoints(e: ElementWithId): { anchor: Anchor; point: Point }[] {
  const box = isAttachable(e) ? attachBox(e) : null
  if (!box) return []
  return (["top", "right", "bottom", "left"] as const).map((anchor) => ({
    anchor,
    point: anchorPoint(box.position, box.size, anchor),
  }))
}

/** Where one connector end is drawn right now (the copied fallback, when copying). */
export function connectorEndAsDrawn(
  end: Parameters<typeof resolveConnectorEnd>[0],
  byId: ReadonlyMap<string, ElementWithId>,
): Point {
  return resolveConnectorEnd(end, byId, attachBox)
}

/** A connector's two ends, resolved against the Elements as drawn. */
export function connectorEnds(
  e: Extract<ElementWithId, { type: "connector" }>,
  byId: ReadonlyMap<string, ElementWithId>,
): { start: Point; end: Point } {
  return resolveConnector(e, byId, attachBox)
}

/** The points a line-like Element is drawn through (an arrow's 2, a connector's 2–4), or null. */
export function linePath(
  e: ElementWithId,
  byId: ReadonlyMap<string, ElementWithId>,
): Point[] | null {
  if (e.type === "arrow") {
    return [
      { x: e.position.x + e.ends.from.x, y: e.position.y + e.ends.from.y },
      { x: e.position.x + e.ends.to.x, y: e.position.y + e.ends.to.y },
    ]
  }
  if (e.type === "connector") {
    const { start, end } = connectorEnds(e, byId)
    const anchorOf = (side: typeof e.start) =>
      attachedTarget(side, byId) ? side.anchor : undefined
    return connectorPath(start, anchorOf(e.start), end, anchorOf(e.end), e.style)
  }
  return null
}

// ---------- Pen strokes ----------

/** Stroke widths in world units (DESIGN.md → Canvas). */
export const PEN_WIDTHS: Record<PenWidth, number> = { S: 2, M: 4, L: 8 }

export function absolutePoints(e: PenElement): StrokePoint[] {
  return e.points.map(([x, y, pressure]) => [e.position.x + x, e.position.y + y, pressure])
}

/** A stroke's outline as perfect-freehand draws it (shared by the canvas and SVG). */
export function strokeOutline(
  points: readonly StrokePoint[],
  width: PenWidth,
  complete = true,
): number[][] {
  return getStroke(points as StrokePoint[], {
    size: PEN_WIDTHS[width],
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: false,
    last: complete,
  })
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
  fillOutline(ctx, strokeOutline(points, width, complete), color)
}

/**
 * Finished strokes' outlines, by Element. Elements are replaced, never changed, when edited,
 * so a stroke's outline is worked out once instead of on every frame.
 */
const penOutlines = new WeakMap<PenElement, number[][]>()

function penOutline(e: PenElement): number[][] {
  let outline = penOutlines.get(e)
  if (!outline) {
    outline = strokeOutline(absolutePoints(e), e.width)
    penOutlines.set(e, outline)
  }
  return outline
}

/** Below this on-screen size (px, the longer side), a pen stroke is drawn as a simple line. */
export const PEN_SKETCH_BELOW_PX = 48

/** True when a pen stroke is small enough on screen to draw as a simple line. */
export function sketchPen(e: PenElement, zoom: number | null): boolean {
  return zoom !== null && Math.max(e.size.w, e.size.h) * zoom < PEN_SKETCH_BELOW_PX
}

/**
 * A small pen stroke as a plain line through its points, skipping any closer than 2px on
 * screen to the last one kept. Its outline would be the same few pixels at many times the cost.
 */
function drawPenSketch(ctx: CanvasRenderingContext2D, e: PenElement, color: string, zoom: number) {
  const step = 2 / zoom
  const [first, ...rest] = e.points
  if (!first) return
  ctx.beginPath()
  let [lx, ly] = first
  ctx.moveTo(e.position.x + lx, e.position.y + ly)
  for (const [i, [x, y]] of rest.entries()) {
    if (i < rest.length - 1 && Math.abs(x - lx) < step && Math.abs(y - ly) < step) continue
    ctx.lineTo(e.position.x + x, e.position.y + y)
    lx = x
    ly = y
  }
  ctx.lineWidth = PEN_WIDTHS[e.width]
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.strokeStyle = color
  ctx.stroke()
  ctx.lineCap = "butt"
  ctx.lineJoin = "miter"
}

function fillOutline(ctx: CanvasRenderingContext2D, outline: number[][], color: string) {
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
  detailZoom: number | null = null,
) {
  boxPath(ctx, p, s, Math.min(4, s.w / 2, s.h / 2), detailZoom)
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
  handles = true,
) {
  ctx.lineWidth = 1.5
  ctx.strokeStyle = colors.primary
  ctx.strokeRect(p.x, p.y, s.w, s.h)
  if (!handles) return
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

// ---------- Lock badge (DESIGN.md → Canvas → Lock) ----------

/** Badge size in screen px. */
const BADGE = 20

/**
 * Where a locked Element's badge sits, in screen px: centered on the top-right corner of its
 * box (for a line, on its end). Clicking it selects the Element so it can be unlocked.
 */
export function lockBadgeRect(
  e: ElementWithId,
  byId: ReadonlyMap<string, ElementWithId>,
  camera: Camera,
): { x: number; y: number; w: number; h: number } {
  const line = lineEnds(e, byId)
  const box = elementBox(e, byId)
  const corner = line ? line.to : { x: box.position.x + box.size.w, y: box.position.y }
  const p = worldToScreen(camera, corner)
  return { x: p.x - BADGE / 2, y: p.y - BADGE / 2, w: BADGE, h: BADGE }
}

function drawLockBadge(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  colors: (typeof CANVAS)[Theme],
) {
  ctx.beginPath()
  ctx.roundRect(r.x, r.y, r.w, r.h, 6)
  ctx.fillStyle = colors.surface
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = colors.border
  ctx.stroke()
  // A padlock: a shackle arc over a rounded body.
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  ctx.strokeStyle = colors.mutedForeground
  ctx.fillStyle = colors.mutedForeground
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy - 1.5, 3, Math.PI, 0)
  ctx.lineTo(cx + 3, cy + 0.5)
  ctx.moveTo(cx - 3, cy - 1.5)
  ctx.lineTo(cx - 3, cy + 0.5)
  ctx.stroke()
  ctx.beginPath()
  ctx.roundRect(cx - 4.5, cy, 9, 6.5, 1.5)
  ctx.fill()
}

// ---------- Snap indicator (DESIGN.md → Canvas → Connectors) ----------

function drawSnapPoints(
  ctx: CanvasRenderingContext2D,
  snap: { points: readonly Point[]; active: Point | null },
  camera: Camera,
  colors: (typeof CANVAS)[Theme],
) {
  ctx.lineWidth = 1.5
  ctx.strokeStyle = colors.primary
  for (const point of snap.points) {
    const p = worldToScreen(camera, point)
    const active = snap.active !== null && snap.active.x === point.x && snap.active.y === point.y
    ctx.beginPath()
    ctx.arc(p.x, p.y, active ? 6 : 4, 0, Math.PI * 2)
    ctx.fillStyle = active ? colors.primary : colors.handleFill
    ctx.fill()
    ctx.stroke()
  }
}

// ---------- Pictures (clipboard PNG, PNG export, thumbnails) ----------

/** Largest clipboard picture side, in pixels: big selections are scaled down to fit. */
const IMAGE_MAX_SIDE = 4096
/** Largest PNG export side (PRD Limits): bigger exports are scaled down, with a notice. */
export const EXPORT_MAX_SIDE = 8192

/**
 * The pixel size for a picture of `bounds` (world units) with `padding` around it, at
 * `scale` pixels per unit, shrunk to fit `maxSide`. `scale` is what was used: below the one
 * asked for when the picture had to shrink.
 */
export function imageSize(
  bounds: { w: number; h: number },
  scale = 2,
  padding = 16,
  maxSide = IMAGE_MAX_SIDE,
): { w: number; h: number; scale: number } {
  const w = bounds.w + padding * 2
  const h = bounds.h + padding * 2
  const fit = Math.min(scale, maxSide / Math.max(w, h, 1))
  return { w: Math.max(1, Math.ceil(w * fit)), h: Math.max(1, Math.ceil(h * fit)), scale: fit }
}

/**
 * Draws `elements` (with `byId` for connector ends) into a context sized by `imageSize`: no
 * grid, no selection, the bounds framed by the padding, in the light theme unless asked.
 */
export function drawImage(
  ctx: CanvasRenderingContext2D,
  elements: readonly ElementWithId[],
  byId: ReadonlyMap<string, ElementWithId>,
  bounds: { x: number; y: number; w: number; h: number },
  size: { w: number; h: number; scale: number },
  padding = 16,
  images?: ImageSource,
  theme: Theme = "light",
) {
  drawScene(ctx, {
    images,
    elements,
    byId,
    camera: {
      zoom: size.scale,
      x: (padding - bounds.x) * size.scale,
      y: (padding - bounds.y) * size.scale,
    },
    theme,
    size: { w: size.w, h: size.h },
    dpr: 1,
    selection: new Set(),
    showGrid: false,
    lineZoom: 1,
  })
}

// ---------- Remote selections (DESIGN.md → Canvas → Remote selection) ----------

export type RemoteSelection = {
  name: string
  color: string
  ids?: readonly string[]
  box?: { x: number; y: number; w: number; h: number }
}

/**
 * A Collaborator's selection: a 1.5px outline in their presence color around each selected
 * Element (or around the box of a large selection), and their name in a small tag above the
 * top-left corner. Screen space, so it keeps its size at any zoom. Selected Elements that no
 * longer exist are skipped; when none are left, nothing is drawn.
 */
function drawRemoteSelection(
  ctx: CanvasRenderingContext2D,
  remote: RemoteSelection,
  byId: ReadonlyMap<string, ElementWithId>,
  camera: Camera,
) {
  const boxes: { x: number; y: number; w: number; h: number }[] = []
  ctx.lineWidth = 1.5
  ctx.strokeStyle = remote.color
  if (remote.box) {
    const p = worldToScreen(camera, remote.box)
    boxes.push({ x: p.x, y: p.y, w: remote.box.w * camera.zoom, h: remote.box.h * camera.zoom })
  }
  for (const id of remote.ids ?? []) {
    const e = byId.get(id)
    if (!e) continue
    const path = linePath(e, byId)
    if (path) {
      // Lines are outlined along their path, not with a box.
      ctx.beginPath()
      for (const [j, point] of path.entries()) {
        const q = worldToScreen(camera, point)
        if (j === 0) ctx.moveTo(q.x, q.y)
        else ctx.lineTo(q.x, q.y)
      }
      ctx.stroke()
    }
    const { position, size } = elementBox(e, byId)
    const p = worldToScreen(camera, position)
    const box = { x: p.x, y: p.y, w: size.w * camera.zoom, h: size.h * camera.zoom }
    if (!path) ctx.strokeRect(box.x, box.y, box.w, box.h)
    boxes.push(box)
  }
  if (remote.box) {
    const [b] = boxes
    if (b) ctx.strokeRect(b.x, b.y, b.w, b.h)
  }
  if (boxes.length === 0) return

  // The name tag sits above the selection's top-left corner (DESIGN.md `cursor-label`).
  const left = Math.min(...boxes.map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  ctx.font = `500 11px ${TEXT_FONT_FAMILY}`
  const textWidth = ctx.measureText(remote.name).width
  const tag = { x: left, y: top - 4 - 18, w: textWidth + 12, h: 18 }
  ctx.beginPath()
  ctx.roundRect(tag.x, tag.y, tag.w, tag.h, 9)
  ctx.fillStyle = remote.color
  ctx.fill()
  ctx.fillStyle = "#FFFFFF"
  ctx.textBaseline = "middle"
  ctx.fillText(remote.name, tag.x + 6, tag.y + tag.h / 2 + 0.5)
}
