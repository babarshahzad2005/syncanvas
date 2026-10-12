import type * as Y from "yjs"
import { type ElementWithId, elementsOf, type Point } from "./model"

// ---------- Resize (spec: Resize) ----------
//
// Resizing maps the selection's box `from` onto a new box `to`: every Element's geometry is
// scaled around the box's corner, so a multi-selection keeps its layout. Font sizes are
// steps (S/M/L/XL), so text and sticky notes change their width and rewrap instead.

export type Rect = { x: number; y: number; w: number; h: number }

/** Narrowest a fixed-width text can get, in canvas units. */
export const MIN_TEXT_WIDTH = 20
/** Narrowest a sticky note can get (its height follows its width). */
export const MIN_STICKY_WIDTH = 80

/** Geometry fields a resize may write, each replaced whole (ADR 0002). */
export type Geometry = {
  position?: Point
  size?: { w: number; h: number }
  points?: [number, number, number][]
  ends?: { from: Point; to: Point }
  autoWidth?: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The fields that make `e` follow its selection box being scaled from `from` to `to`, or
 * null when nothing about it changes (connectors follow the Elements they attach to).
 * `single`: `e` is the only Element being resized, so an auto-width text becomes a
 * fixed-width one; in a multi-selection it only moves.
 */
export function scaledGeometry(
  e: ElementWithId,
  from: Rect,
  to: Rect,
  single: boolean,
): Geometry | null {
  if (e.type === "connector") return null
  const sx = from.w > 0 ? to.w / from.w : 1
  const sy = from.h > 0 ? to.h / from.h : 1
  const position = {
    x: to.x + (e.position.x - from.x) * sx,
    y: to.y + (e.position.y - from.y) * sy,
  }
  const size = { w: e.size.w * sx, h: e.size.h * sy }
  switch (e.type) {
    case "rect":
    case "ellipse":
      return { position, size }
    case "pen":
      return {
        position,
        size,
        points: e.points.map(([x, y, pressure]) => [round2(x * sx), round2(y * sy), pressure]),
      }
    case "arrow":
      return {
        position,
        size,
        ends: {
          from: { x: e.ends.from.x * sx, y: e.ends.from.y * sy },
          to: { x: e.ends.to.x * sx, y: e.ends.to.y * sy },
        },
      }
    case "text":
      if (e.autoWidth && !single) return { position }
      return {
        position,
        // The height is the text's layout; only the width (where lines wrap) is set.
        size: { w: Math.max(MIN_TEXT_WIDTH, single ? to.w : e.size.w * sx), h: e.size.h },
        autoWidth: false,
      }
    case "sticky": {
      const w = Math.max(MIN_STICKY_WIDTH, e.size.w * sx)
      return { position, size: { w, h: w } }
    }
  }
}

/** An arrow's box and relative ends for absolute end points (dragging one end). */
export function arrowGeometry(
  from: Point,
  to: Point,
): Required<Pick<Geometry, "position" | "size" | "ends">> {
  const position = { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) }
  const relative = (p: Point) => ({ x: p.x - position.x, y: p.y - position.y })
  return {
    position,
    size: { w: Math.abs(to.x - from.x), h: Math.abs(to.y - from.y) },
    ends: { from: relative(from), to: relative(to) },
  }
}

/** Writes new geometry for several Elements in one transaction (one undo step per send). */
export function setGeometry(
  doc: Y.Doc,
  changes: Iterable<readonly [string, Geometry]>,
  origin: unknown,
) {
  doc.transact(() => {
    for (const [id, geometry] of changes) {
      const fields = elementsOf(doc).get(id)
      if (!fields?.has("position")) continue // deleted meanwhile
      for (const [key, value] of Object.entries(geometry)) {
        if (value !== undefined) fields.set(key, value)
      }
    }
  }, origin)
}
