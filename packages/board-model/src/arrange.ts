import { generateNKeysBetween } from "fractional-indexing"
import type * as Y from "yjs"
import { refreshFallbacks } from "./connectors"
import { cleanStaleGroups } from "./groups"
import { type ElementWithId, elementsOf, listElements, type Point } from "./model"
import type { Rect } from "./resize"

// ---------- Layering, align, distribute (spec: Layering) ----------
//
// Callers pass `boxOf`, an Element's box as drawn (text and sticky boxes come from layout,
// which this package can't do); the convergence suite passes the stored geometry.

export type BoxOf = (e: ElementWithId) => Rect | null

const overlaps = (a: Rect, b: Rect) =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h

function union(boxes: readonly Rect[]): Rect | null {
  if (boxes.length === 0) return null
  const minX = Math.min(...boxes.map((b) => b.x))
  const minY = Math.min(...boxes.map((b) => b.y))
  const maxX = Math.max(...boxes.map((b) => b.x + b.w))
  const maxY = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * Brings the Elements forward (or sends them backward) one step: just past the next
 * unselected Element above (below) them that overlaps them, keeping their own order. New z
 * keys are fractional indexes between that Element and its neighbor, so nobody else's z
 * changes. Returns false when nothing overlapping is in the way (no visible change).
 *
 * Concurrent edits can leave two Elements with the same key (both clients picked the same
 * gap). Ties sort by id everywhere, and keys are only ever generated between distinct keys,
 * so a tie never breaks later reordering.
 */
export function reorderElements(
  doc: Y.Doc,
  ids: Iterable<string>,
  direction: "forward" | "backward",
  boxOf: BoxOf,
  origin: unknown,
): boolean {
  const all = listElements(doc)
  const selected = new Set(ids)
  const moving = all.filter((e) => selected.has(e.id))
  const area = union(moving.flatMap((e) => boxOf(e) ?? []))
  if (moving.length === 0 || !area) return false
  const indexes = moving.map((e) => all.indexOf(e))
  const blocks = (e: ElementWithId | undefined) => {
    const box = e && !selected.has(e.id) ? boxOf(e) : null
    return box !== null && overlaps(box, area)
  }

  let lower: string | null
  let upper: string | null
  if (direction === "forward") {
    let j = Math.max(...indexes) + 1
    while (j < all.length && !blocks(all[j])) j++
    const past = all[j]
    if (!past) return false
    lower = past.z
    upper = all.slice(j + 1).find((e) => e.z > past.z)?.z ?? null
  } else {
    let j = Math.min(...indexes) - 1
    while (j >= 0 && !blocks(all[j])) j--
    const past = all[j]
    if (!past) return false
    upper = past.z
    lower =
      all
        .slice(0, j)
        .reverse()
        .find((e) => e.z < past.z)?.z ?? null
  }

  const keys = generateNKeysBetween(lower, upper, moving.length)
  const elements = elementsOf(doc)
  doc.transact(() => {
    for (const [i, e] of moving.entries()) elements.get(e.id)?.set("z", keys[i])
    cleanStaleGroups(
      doc,
      moving.map((e) => e.id),
    )
  }, origin)
  return true
}

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom"

/** Something that aligns and distributes as one: a single Element, or a whole group. */
export type ArrangeUnit = { ids: readonly string[]; box: Rect }

/**
 * How far each unit moves to line up its edges or centers with the selection's. Units that
 * already line up get no entry.
 */
export function alignUnits(
  units: readonly ArrangeUnit[],
  alignment: Alignment,
): Map<number, Point> {
  const out = new Map<number, Point>()
  const all = union(units.map((u) => u.box))
  if (!all || units.length < 2) return out
  for (const [i, { box }] of units.entries()) {
    let dx = 0
    let dy = 0
    if (alignment === "left") dx = all.x - box.x
    if (alignment === "center") dx = all.x + all.w / 2 - (box.x + box.w / 2)
    if (alignment === "right") dx = all.x + all.w - (box.x + box.w)
    if (alignment === "top") dy = all.y - box.y
    if (alignment === "middle") dy = all.y + all.h / 2 - (box.y + box.h / 2)
    if (alignment === "bottom") dy = all.y + all.h - (box.y + box.h)
    if (dx !== 0 || dy !== 0) out.set(i, { x: dx, y: dy })
  }
  return out
}

/**
 * How far each unit moves so the gaps between neighbors are equal along one axis. The first
 * and last units (by their leading edge) stay put; needs 3 or more.
 */
export function distributeUnits(
  units: readonly ArrangeUnit[],
  axis: "horizontal" | "vertical",
): Map<number, Point> {
  const out = new Map<number, Point>()
  if (units.length < 3) return out
  const start = (b: Rect) => (axis === "horizontal" ? b.x : b.y)
  const length = (b: Rect) => (axis === "horizontal" ? b.w : b.h)
  const order = units.map((u, i) => ({ i, box: u.box })).sort((a, b) => start(a.box) - start(b.box))
  const first = order[0]
  const last = order.at(-1)
  if (!first || !last) return out
  const span = start(last.box) + length(last.box) - start(first.box)
  const total = order.reduce((sum, u) => sum + length(u.box), 0)
  const gap = (span - total) / (order.length - 1)
  let at = start(first.box)
  for (const { i, box } of order) {
    const d = at - start(box)
    if (d !== 0) out.set(i, axis === "horizontal" ? { x: d, y: 0 } : { x: 0, y: d })
    at += length(box) + gap
  }
  return out
}

/** Applies unit offsets as one transaction (one undo step). */
export function moveUnits(
  doc: Y.Doc,
  units: readonly ArrangeUnit[],
  offsets: ReadonlyMap<number, Point>,
  origin: unknown,
) {
  if (offsets.size === 0) return
  const elements = elementsOf(doc)
  doc.transact(() => {
    const moved: string[] = []
    for (const [i, d] of offsets) {
      for (const id of units[i]?.ids ?? []) {
        const fields = elements.get(id)
        const p = fields?.get("position") as Point | undefined
        if (!fields || !p) continue // connectors follow their ends
        fields.set("position", { x: p.x + d.x, y: p.y + d.y })
        moved.push(id)
      }
    }
    cleanStaleGroups(doc, moved)
    refreshFallbacks(doc, moved)
  }, origin)
}
