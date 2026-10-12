import type { ElementWithId, Rect } from "@syncanvas/board-model"
import RBush from "rbush"
import { elementBox, PEN_WIDTHS } from "./index"

// A spatial index over the Board's Elements (spec: "rbush index built from the document and
// updated incrementally"), so hit-testing and drawing only look at what's near the viewport
// or the pointer, and large Boards stay fast.
//
// Connectors aren't in the tree: their box depends on the Elements they attach to, which can
// move without the connector changing. There are few of them, so every query returns them all.

type Entry = { minX: number; minY: number; maxX: number; maxY: number; id: string }

export class ElementIndex {
  /** Every Element by id, for connectors to look up what they attach to. */
  readonly byId = new Map<string, ElementWithId>()
  private readonly tree = new RBush<Entry>()
  private readonly entries = new Map<string, Entry>()
  private readonly connectors = new Set<string>()
  /** Elements in drawing order (z, then id), rebuilt only when that order may change. */
  private sorted: ElementWithId[] | null = null
  private readonly order = new Map<string, number>()

  constructor(elements: Iterable<ElementWithId> = []) {
    this.reset(elements)
  }

  /** Replaces everything (on load, or once text metrics change after the web font loads). */
  reset(elements: Iterable<ElementWithId>) {
    this.byId.clear()
    this.entries.clear()
    this.connectors.clear()
    this.tree.clear()
    for (const e of elements) this.byId.set(e.id, e)
    const entries: Entry[] = []
    for (const e of this.byId.values()) {
      const entry = this.entryOf(e)
      if (entry) {
        this.entries.set(e.id, entry)
        entries.push(entry)
      } else this.connectors.add(e.id)
    }
    this.tree.load(entries)
    this.sorted = null
  }

  /** Applies changed Elements; null means the Element is gone (or no longer valid). */
  update(changes: Iterable<readonly [string, ElementWithId | null]>) {
    for (const [id, next] of changes) {
      const before = this.byId.get(id)
      const entry = this.entries.get(id)
      if (entry) {
        this.tree.remove(entry)
        this.entries.delete(id)
      }
      this.connectors.delete(id)
      if (!next) {
        this.byId.delete(id)
        this.sorted = null
        continue
      }
      this.byId.set(id, next)
      const fresh = this.entryOf(next)
      if (fresh) {
        this.entries.set(id, fresh)
        this.tree.insert(fresh)
      } else this.connectors.add(id)
      // Moves and restyles keep the drawing order: swap the Element in place.
      const at = this.order.get(id)
      if (this.sorted && before && before.z === next.z && at !== undefined) this.sorted[at] = next
      else this.sorted = null
    }
  }

  get size() {
    return this.byId.size
  }

  /** All Elements in drawing order. */
  all(): ElementWithId[] {
    if (!this.sorted) {
      this.sorted = [...this.byId.values()].sort((a, b) =>
        a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1,
      )
      this.order.clear()
      for (const [i, e] of this.sorted.entries()) this.order.set(e.id, i)
    }
    return this.sorted
  }

  /**
   * Elements whose box touches `rect` (plus every connector, and any `extra` ids), in
   * drawing order.
   */
  query(rect: Rect, extra: Iterable<string> = []): ElementWithId[] {
    this.all() // makes sure `order` is current
    const ids = new Set(this.connectors)
    for (const entry of this.tree.search(toBox(rect))) ids.add(entry.id)
    for (const id of extra) if (this.byId.has(id)) ids.add(id)
    return [...ids]
      .sort((a, b) => (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0))
      .map((id) => this.byId.get(id) as ElementWithId)
  }

  /** Ids of the Elements lying entirely inside `rect` (marquee selection). */
  inside(rect: Rect): string[] {
    const box = toBox(rect)
    const contains = (b: Omit<Entry, "id">) =>
      b.minX >= box.minX && b.maxX <= box.maxX && b.minY >= box.minY && b.maxY <= box.maxY
    const ids = this.tree
      .search(box)
      .filter(contains)
      .map((entry) => entry.id)
    for (const id of this.connectors) {
      const e = this.byId.get(id)
      if (e && contains(toBox(boxRect(e, this.byId)))) ids.push(id)
    }
    return ids
  }

  private entryOf(e: ElementWithId): Entry | null {
    if (e.type === "connector") return null
    const rect = boxRect(e, this.byId)
    // A pen stroke's ink reaches half its width past the points.
    const pad = e.type === "pen" ? PEN_WIDTHS[e.width] / 2 : 0
    return {
      ...toBox({ x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 }),
      id: e.id,
    }
  }
}

function boxRect(e: ElementWithId, byId: ReadonlyMap<string, ElementWithId>): Rect {
  const { position, size } = elementBox(e, byId)
  return { x: position.x, y: position.y, w: size.w, h: size.h }
}

/** A rect as an rbush box; negative sizes (a marquee dragged up or left) are normalized. */
function toBox(r: Rect) {
  return {
    minX: Math.min(r.x, r.x + r.w),
    minY: Math.min(r.y, r.y + r.h),
    maxX: Math.max(r.x, r.x + r.w),
    maxY: Math.max(r.y, r.y + r.h),
  }
}
