import type * as Y from "yjs"
import {
  type Anchor,
  type ConnectorElement,
  type ConnectorEnd,
  type ConnectorStyle,
  type ElementWithId,
  elementsOf,
  hasBox,
  type Point,
  readElement,
  type Size,
} from "./model"

// ---------- Connectors (GLOSSARY: Connector) ----------
//
// A connector's ends are computed when drawn, from the attached Elements' current geometry,
// so they follow shapes whoever moves them. When an attached Element doesn't exist (deleted,
// or not pasted along), that end sits at its stored `fallback`.

/** A point on a box: a side midpoint, or the center when no anchor is given. */
export function anchorPoint(position: Point, size: Size, anchor?: Anchor): Point {
  const cx = position.x + size.w / 2
  const cy = position.y + size.h / 2
  switch (anchor) {
    case "top":
      return { x: cx, y: position.y }
    case "right":
      return { x: position.x + size.w, y: cy }
    case "bottom":
      return { x: cx, y: position.y + size.h }
    case "left":
      return { x: position.x, y: cy }
    default:
      return { x: cx, y: cy }
  }
}

/**
 * An Element's box for attaching. The renderer passes the drawn box (text and sticky boxes
 * come from their layout); the default is the stored geometry.
 */
export type AttachBox = (e: ElementWithId) => { position: Point; size: Size } | null
const storedBox: AttachBox = (e) => (hasBox(e) ? { position: e.position, size: e.size } : null)

/** Shapes, text, and sticky notes take connectors (spec: Connectors); lines and pens don't. */
export function isAttachable(e: ElementWithId): boolean {
  return e.type === "rect" || e.type === "ellipse" || e.type === "text" || e.type === "sticky"
}

/** The Element an end is attached to, if it still exists (else the end is at its fallback). */
export function attachedTarget(
  end: ConnectorEnd,
  byId: ReadonlyMap<string, ElementWithId>,
): ElementWithId | undefined {
  const target = end.elementId === undefined ? undefined : byId.get(end.elementId)
  return target && isAttachable(target) ? target : undefined
}

/** Where one end of a connector is right now. Connectors can't attach to connectors. */
export function resolveConnectorEnd(
  end: ConnectorEnd,
  byId: ReadonlyMap<string, ElementWithId>,
  boxOf: AttachBox = storedBox,
): Point {
  const target = attachedTarget(end, byId)
  const box = target && boxOf(target)
  if (!box) return end.fallback
  return anchorPoint(box.position, box.size, end.anchor)
}

/** Both ends of a connector, resolved against the Board's current Elements. */
export function resolveConnector(
  connector: ConnectorElement,
  byId: ReadonlyMap<string, ElementWithId>,
  boxOf: AttachBox = storedBox,
): { start: Point; end: Point } {
  return {
    start: resolveConnectorEnd(connector.start, byId, boxOf),
    end: resolveConnectorEnd(connector.end, byId, boxOf),
  }
}

// ---------- Writing connectors ----------

/** Sets a connector's style. Other types are left alone. */
export function setConnectorStyle(doc: Y.Doc, id: string, style: ConnectorStyle, origin: unknown) {
  const fields = elementsOf(doc).get(id)
  if (fields?.get("type") !== "connector") return
  doc.transact(() => fields.set("style", style), origin)
}

/**
 * Keeps the fallbacks of connectors attached to `changed` Elements at their current anchor
 * points, so an end stays where its Element was if someone deletes it (spec: fallback points
 * kept current on local writes). Runs inside the transaction that moved or deletes them;
 * uses the stored geometry, the only box this package knows.
 */
export function refreshFallbacks(doc: Y.Doc, changed: Iterable<string>) {
  const ids = new Set(changed)
  if (ids.size === 0) return
  const elements = elementsOf(doc)
  for (const fields of elements.values()) {
    if (fields.get("type") !== "connector") continue
    for (const which of ["start", "end"] as const) {
      const end = fields.get(which) as ConnectorEnd | undefined
      if (!end?.elementId || !ids.has(end.elementId)) continue
      const targetFields = elements.get(end.elementId)
      const target = targetFields ? readElement(targetFields) : null
      if (!target || !hasBox(target)) continue
      const fallback = anchorPoint(target.position, target.size, end.anchor)
      if (fallback.x === end.fallback.x && fallback.y === end.fallback.y) continue
      fields.set(which, { ...end, fallback })
    }
  }
}

/** Ids → Elements, for resolving connectors. */
export function indexById(elements: readonly ElementWithId[]): Map<string, ElementWithId> {
  return new Map(elements.map((e) => [e.id, e]))
}
