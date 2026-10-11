import type { ElementWithId, PaletteColor, Point, Size } from "@syncanvas/board-model"

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

export function boundsOf(elements: readonly { position: Point; size: Size }[]) {
  if (elements.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const e of elements) {
    minX = Math.min(minX, e.position.x)
    minY = Math.min(minY, e.position.y)
    maxX = Math.max(maxX, e.position.x + e.size.w)
    maxY = Math.max(maxY, e.position.y + e.size.h)
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

const CANVAS = {
  light: { background: "#F8F7F4", gridDot: "#D9D5CE", primary: "#5145CD", handleFill: "#FFFFFF" },
  dark: { background: "#161514", gridDot: "#45423D", primary: "#8C82F6", handleFill: "#FFFFFF" },
} as const

export function paletteShades(color: PaletteColor, theme: Theme): Shades {
  return PALETTE[color][theme]
}

// ---------- Hit testing ----------

/** The topmost Element under a world point, with a small screen-space tolerance. */
export function hitTest(
  elements: readonly ElementWithId[],
  world: Point,
  zoom: number,
): string | null {
  const tolerance = 4 / zoom
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i]
    if (!e) continue
    if (
      world.x >= e.position.x - tolerance &&
      world.x <= e.position.x + e.size.w + tolerance &&
      world.y >= e.position.y - tolerance &&
      world.y <= e.position.y + e.size.h + tolerance
    ) {
      return e.id
    }
  }
  return null
}

// ---------- Drawing ----------

export type Scene = {
  elements: readonly ElementWithId[]
  camera: Camera
  theme: Theme
  /** CSS pixel size of the canvas. */
  size: Size
  dpr: number
  selection: ReadonlySet<string>
  /** Positions overriding the document while a local drag is in progress. */
  dragging?: ReadonlyMap<string, Point>
  /** The rectangle being drawn, in world coordinates (not yet in the document). */
  preview?: { position: Point; size: Size; color: PaletteColor } | null
  showGrid?: boolean
}

export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { camera, theme, size, dpr } = scene
  const colors = CANVAS[theme]

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = colors.background
  ctx.fillRect(0, 0, size.w, size.h)

  if (scene.showGrid !== false) drawGrid(ctx, camera, size, colors.gridDot)

  ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.x, dpr * camera.y)
  for (const e of scene.elements) {
    const position = scene.dragging?.get(e.id) ?? e.position
    drawRect(ctx, position, e.size, paletteShades(e.color, theme), camera.zoom)
  }
  if (scene.preview) {
    const p = scene.preview
    const x = p.size.w < 0 ? p.position.x + p.size.w : p.position.x
    const y = p.size.h < 0 ? p.position.y + p.size.h : p.position.y
    drawRect(
      ctx,
      { x, y },
      { w: Math.abs(p.size.w), h: Math.abs(p.size.h) },
      paletteShades(p.color, theme),
      camera.zoom,
    )
  }

  // Selection chrome is drawn in screen space so handles keep a constant size at any zoom.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  for (const e of scene.elements) {
    if (!scene.selection.has(e.id)) continue
    const position = scene.dragging?.get(e.id) ?? e.position
    drawSelection(
      ctx,
      worldToScreen(camera, position),
      {
        w: e.size.w * camera.zoom,
        h: e.size.h * camera.zoom,
      },
      colors,
    )
  }
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

function drawRect(ctx: CanvasRenderingContext2D, p: Point, s: Size, shades: Shades, zoom: number) {
  const radius = Math.min(4, s.w / 2, s.h / 2)
  ctx.beginPath()
  ctx.roundRect(p.x, p.y, s.w, s.h, radius)
  ctx.fillStyle = shades.fill
  ctx.fill()
  ctx.lineWidth = 2 / Math.max(zoom, 0.5) // stays legible when zoomed out
  ctx.strokeStyle = shades.stroke
  ctx.stroke()
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
  const half = 4
  for (const [hx, hy] of [
    [p.x, p.y],
    [p.x + s.w, p.y],
    [p.x, p.y + s.h],
    [p.x + s.w, p.y + s.h],
  ] as const) {
    ctx.beginPath()
    ctx.roundRect(hx - half, hy - half, half * 2, half * 2, 2)
    ctx.fillStyle = colors.handleFill
    ctx.fill()
    ctx.stroke()
  }
}
