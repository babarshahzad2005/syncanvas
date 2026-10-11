import type * as Y from "yjs"
import { elementsOf, type PaletteColor, PEN_POINT_LIMIT, type PenWidth } from "./model"
import { addElement } from "./ops"

// ---------- Pen strokes ----------
//
// A stroke is captured locally while drawing and written once, on pointer-up, as one Element.
// Points are stored relative to the stroke's box, as [x, y, pressure], and never edited
// afterwards except by move and scale.

/** [x, y, pressure 0–1] in world coordinates. */
export type StrokePoint = [number, number, number]

const round2 = (n: number) => Math.round(n * 100) / 100

function distanceToSegment(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/**
 * Drops points that lie within `tolerance` of the line through their neighbours
 * (Ramer–Douglas–Peucker on x/y). The first and last points are always kept.
 */
export function simplifyStroke(points: readonly StrokePoint[], tolerance: number): StrokePoint[] {
  if (points.length <= 2) return [...points]
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number]
    const a = points[start] as StrokePoint
    const b = points[end] as StrokePoint
    let farthest = -1
    let farthestDistance = tolerance
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i] as StrokePoint, a, b)
      if (d > farthestDistance) {
        farthest = i
        farthestDistance = d
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1
      stack.push([start, farthest], [farthest, end])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}

/** Drops points within `tolerance` of the previous kept point. Linear time; keeps the ends. */
function thinStroke(points: readonly StrokePoint[], tolerance: number): StrokePoint[] {
  const out: StrokePoint[] = []
  for (const [i, p] of points.entries()) {
    const last = out.at(-1)
    if (
      !last ||
      i === points.length - 1 ||
      Math.hypot(p[0] - last[0], p[1] - last[1]) > tolerance
    ) {
      out.push(p)
    }
  }
  return out
}

/**
 * Adds a finished stroke. `points` are in world coordinates; they're simplified (thinned
 * first if needed to stay under the point limit), rounded, and stored relative to the
 * stroke's box. Returns the new id, or null for an empty stroke.
 */
export function addPen(
  doc: Y.Doc,
  stroke: {
    points: readonly StrokePoint[]
    color: PaletteColor
    width: PenWidth
    tolerance: number
  },
  origin: unknown,
): string | null {
  if (stroke.points.length === 0) return null
  // Thin oversized strokes in linear time first: the precise pass is quadratic at worst.
  let points = [...stroke.points]
  for (let thin = Math.max(stroke.tolerance, 0.01); points.length > PEN_POINT_LIMIT; thin *= 2) {
    points = thinStroke(points, thin)
  }
  points = simplifyStroke(points, stroke.tolerance)
  const minX = Math.min(...points.map((p) => p[0]))
  const minY = Math.min(...points.map((p) => p[1]))
  const maxX = Math.max(...points.map((p) => p[0]))
  const maxY = Math.max(...points.map((p) => p[1]))
  const position = { x: round2(minX), y: round2(minY) }
  return addElement(
    doc,
    {
      type: "pen",
      position,
      size: { w: round2(maxX - minX), h: round2(maxY - minY) },
      color: stroke.color,
      width: stroke.width,
      points: points.map(
        ([x, y, pressure]): StrokePoint => [
          round2(x - position.x),
          round2(y - position.y),
          round2(Math.min(1, Math.max(0, pressure))),
        ],
      ),
    },
    origin,
  )
}

/** Sets a stroke's width. Other types are left alone. */
export function setPenWidth(doc: Y.Doc, id: string, width: PenWidth, origin: unknown) {
  const fields = elementsOf(doc).get(id)
  if (fields?.get("type") !== "pen") return
  doc.transact(() => fields.set("width", width), origin)
}
