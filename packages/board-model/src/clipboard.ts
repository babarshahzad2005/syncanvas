import { generateNKeysBetween } from "fractional-indexing"
import * as Y from "yjs"
import {
  type ConnectorEnd,
  ELEMENT_CAP,
  type ElementWithId,
  elementsOf,
  listElements,
  type Point,
  readElement,
} from "./model"

// ---------- Copy and paste (spec: Copy and paste; ADR 0011) ----------
//
// Copied Elements travel as plain JSON: their fields as read (text as a string), with each
// connector end's fallback set to where it was drawn when copied. Pasting gives every
// Element a new id, remaps groups and connector attachments among the pasted Elements, and
// writes them all in one transaction on top of the Board.

/** The custom clipboard format (written where the browser supports it; see ADR 0011). */
export const CLIPBOARD_TYPE = "web application/x-syncanvas+json"

export type ClipboardPayload = { syncanvas: 1; elements: ElementWithId[] }

/**
 * The payload for copying `elements` (in drawing order). `resolveEnd` gives where a
 * connector end is drawn right now, which becomes its fallback: if its Element isn't pasted
 * along, that end stays where it was.
 */
export function copyPayload(
  elements: readonly ElementWithId[],
  resolveEnd: (end: ConnectorEnd) => Point,
): ClipboardPayload {
  return {
    syncanvas: 1,
    elements: elements.map((e) =>
      e.type === "connector"
        ? {
            ...e,
            start: { ...e.start, fallback: resolveEnd(e.start) },
            end: { ...e.end, fallback: resolveEnd(e.end) },
          }
        : e,
    ),
  }
}

/**
 * Reads a payload from untrusted JSON (a clipboard can hold anything): only Elements that
 * pass the Board validator survive, and at most the Element cap of them.
 */
export function parsePayload(json: unknown): ElementWithId[] {
  if (typeof json !== "object" || json === null) return []
  const { syncanvas, elements } = json as { syncanvas?: unknown; elements?: unknown }
  if (syncanvas !== 1 || !Array.isArray(elements)) return []
  const scratch = new Y.Doc()
  const map = elementsOf(scratch)
  const out: ElementWithId[] = []
  for (const candidate of elements.slice(0, ELEMENT_CAP)) {
    if (typeof candidate !== "object" || candidate === null) continue
    const { id, ...fields } = candidate as Record<string, unknown>
    if (typeof id !== "string" || id.length === 0 || id.length > 64) continue
    const element = scratch.transact(() => {
      const ymap = toYMap(fields)
      map.set("probe", ymap)
      return readElement(ymap)
    })
    map.delete("probe")
    if (element) out.push({ ...element, id })
  }
  return out
}

function toYMap(fields: Record<string, unknown>): Y.Map<unknown> {
  const ymap = new Y.Map<unknown>()
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (key === "text" && typeof value === "string") {
      const text = new Y.Text()
      text.insert(0, value)
      ymap.set(key, text)
    } else ymap.set(key, value)
  }
  return ymap
}

/**
 * Pastes Elements moved by `offset`, as one transaction with new ids, on top of the Board in
 * their copied order. Groups stay groups (with new groupIds) when 2+ members come along;
 * connector ends stay attached to pasted Elements and become free (at their fallback)
 * otherwise. Returns the new ids.
 */
export function pasteElements(
  doc: Y.Doc,
  elements: readonly ElementWithId[],
  offset: Point,
  origin: unknown,
): string[] {
  if (elements.length === 0) return []
  const ids = new Map(elements.map((e) => [e.id, crypto.randomUUID()]))
  const groupCounts = new Map<string, number>()
  for (const e of elements) {
    if (e.groupId) groupCounts.set(e.groupId, (groupCounts.get(e.groupId) ?? 0) + 1)
  }
  const groups = new Map(
    [...groupCounts].filter(([, count]) => count >= 2).map(([g]) => [g, crypto.randomUUID()]),
  )
  const move = (p: Point) => ({ x: p.x + offset.x, y: p.y + offset.y })
  const remapEnd = (end: ConnectorEnd): ConnectorEnd => {
    const target = end.elementId === undefined ? undefined : ids.get(end.elementId)
    return target
      ? {
          elementId: target,
          ...(end.anchor ? { anchor: end.anchor } : {}),
          fallback: move(end.fallback),
        }
      : { fallback: move(end.fallback) }
  }
  const top = listElements(doc).at(-1)?.z ?? null
  const keys = generateNKeysBetween(top, null, elements.length)
  const map = elementsOf(doc)
  doc.transact(() => {
    for (const [i, e] of elements.entries()) {
      const { id, groupId, ...fields } = e as ElementWithId & Record<string, unknown>
      const values: Record<string, unknown> = { ...fields, z: keys[i] }
      const newGroup = groupId === undefined ? undefined : groups.get(groupId)
      if (newGroup) values.groupId = newGroup
      if (e.type === "connector") {
        values.start = remapEnd(e.start)
        values.end = remapEnd(e.end)
      } else {
        values.position = move(e.position)
      }
      map.set(ids.get(id) as string, toYMap(values))
    }
  }, origin)
  return [...ids.values()]
}
