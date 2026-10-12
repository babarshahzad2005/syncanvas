import { generateKeyBetween } from "fractional-indexing"
import * as Y from "yjs"
import { cleanStaleGroups } from "./groups"
import {
  elementsOf,
  type Fill,
  isStickyColor,
  listElements,
  type PaletteColor,
  type Point,
  type Size,
} from "./model"
import { arrowGeometry } from "./resize"

// ---------- Writing Elements ----------
//
// Every write is one transaction tagged with `origin`, so the UndoManager (which tracks the
// local origin) undoes it as one step.

/** Next z-order key above everything on the Board. */
export function topZ(doc: Y.Doc): string {
  const all = listElements(doc)
  return generateKeyBetween(all.at(-1)?.z ?? null, null)
}

/** Turns a box drawn in any direction into a top-left position and a positive size. */
export function normalizeBox(position: Point, size: Size): { position: Point; size: Size } {
  return {
    position: {
      x: size.w < 0 ? position.x + size.w : position.x,
      y: size.h < 0 ? position.y + size.h : position.y,
    },
    size: { w: Math.abs(size.w), h: Math.abs(size.h) },
  }
}

/**
 * Adds an Element from plain field values. Text fields given as strings become a Y.Text
 * (ADR 0009). `z` defaults to the top of the Board. Returns the new id.
 */
export function addElement(doc: Y.Doc, values: Record<string, unknown>, origin: unknown): string {
  const id = crypto.randomUUID()
  doc.transact(() => {
    const fields = new Y.Map<unknown>()
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue
      if (key === "text" && typeof value === "string") {
        const text = new Y.Text()
        text.insert(0, value)
        fields.set(key, text)
      } else {
        fields.set(key, value)
      }
    }
    if (values.z === undefined) fields.set("z", topZ(doc))
    elementsOf(doc).set(id, fields)
  }, origin)
  return id
}

export type ShapeType = "rect" | "ellipse"

/** Adds a rectangle or ellipse. Drawing "backwards" (right to left) still gives a positive size. */
export function addShape(
  doc: Y.Doc,
  shape: { type: ShapeType; position: Point; size: Size; color?: PaletteColor; fill?: Fill },
  origin: unknown,
): string {
  const box = normalizeBox(shape.position, shape.size)
  return addElement(
    doc,
    { type: shape.type, ...box, color: shape.color ?? "ink", fill: shape.fill ?? "light" },
    origin,
  )
}

export function addRect(
  doc: Y.Doc,
  rect: { position: Point; size: Size; color?: PaletteColor },
  origin: unknown,
): string {
  return addShape(doc, { type: "rect", ...rect }, origin)
}

/** Sets a shape's fill. Other types have no fill and are left alone. */
export function setFill(doc: Y.Doc, id: string, fill: Fill, origin: unknown) {
  const fields = elementsOf(doc).get(id)
  const type = fields?.get("type")
  if (!fields || (type !== "rect" && type !== "ellipse")) return
  doc.transact(() => {
    fields.set("fill", fill)
    cleanStaleGroups(doc, [id])
  }, origin)
}

/**
 * Replaces position whole (ADR 0002): concurrent moves resolve to one chosen position.
 * Connectors have no position of their own; they follow their ends.
 */
export function moveElement(doc: Y.Doc, id: string, position: Point, origin: unknown) {
  const fields = elementsOf(doc).get(id)
  if (!fields?.has("position")) return // deleted by someone else, or a connector
  doc.transact(() => fields.set("position", { x: position.x, y: position.y }), origin)
}

/** Moves several Elements in one transaction (one undo step, one update on the wire). */
export function moveElements(
  doc: Y.Doc,
  positions: Iterable<readonly [string, Point]>,
  origin: unknown,
) {
  doc.transact(() => {
    const moved: string[] = []
    for (const [id, position] of positions) {
      const fields = elementsOf(doc).get(id)
      if (!fields?.has("position")) continue
      fields.set("position", { x: position.x, y: position.y })
      moved.push(id)
    }
    cleanStaleGroups(doc, moved)
  }, origin)
}

/** Sets a color. Sticky notes only take sticky colors; other colors are ignored for them. */
export function recolorElement(doc: Y.Doc, id: string, color: PaletteColor, origin: unknown) {
  const fields = elementsOf(doc).get(id)
  if (!fields) return
  if (fields.get("type") === "sticky" && !isStickyColor(color)) return
  doc.transact(() => {
    fields.set("color", color)
    cleanStaleGroups(doc, [id])
  }, origin)
}

export function deleteElements(doc: Y.Doc, ids: Iterable<string>, origin: unknown) {
  const elements = elementsOf(doc)
  doc.transact(() => {
    const groups = new Set<unknown>()
    for (const id of ids) {
      groups.add(elements.get(id)?.get("groupId"))
      elements.delete(id)
    }
    // A group deleted down to one member dissolves: clean the survivor's groupId.
    groups.delete(undefined)
    if (groups.size === 0) return
    const survivors = [...elements].flatMap(([id, fields]) =>
      groups.has(fields.get("groupId")) ? [id] : [],
    )
    cleanStaleGroups(doc, survivors)
  }, origin)
}

/**
 * Adds a free arrow from `from` to `to` (world coordinates); the arrowhead is at `to`.
 * The ends are stored relative to the arrow's box, so moving it moves both.
 */
export function addArrow(
  doc: Y.Doc,
  arrow: { from: Point; to: Point; color?: PaletteColor },
  origin: unknown,
): string {
  return addElement(
    doc,
    { type: "arrow", ...arrowGeometry(arrow.from, arrow.to), color: arrow.color ?? "ink" },
    origin,
  )
}
