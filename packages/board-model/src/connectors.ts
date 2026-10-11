import {
  type Anchor,
  type ConnectorElement,
  type ConnectorEnd,
  type ElementWithId,
  hasBox,
  type Point,
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

/** Where one end of a connector is right now. Connectors can't attach to connectors. */
export function resolveConnectorEnd(
  end: ConnectorEnd,
  byId: ReadonlyMap<string, ElementWithId>,
): Point {
  const target = end.elementId === undefined ? undefined : byId.get(end.elementId)
  if (!target || !hasBox(target)) return end.fallback
  return anchorPoint(target.position, target.size, end.anchor)
}

/** Both ends of a connector, resolved against the Board's current Elements. */
export function resolveConnector(
  connector: ConnectorElement,
  byId: ReadonlyMap<string, ElementWithId>,
): { start: Point; end: Point } {
  return {
    start: resolveConnectorEnd(connector.start, byId),
    end: resolveConnectorEnd(connector.end, byId),
  }
}

/** Ids → Elements, for resolving connectors. */
export function indexById(elements: readonly ElementWithId[]): Map<string, ElementWithId> {
  return new Map(elements.map((e) => [e.id, e]))
}
