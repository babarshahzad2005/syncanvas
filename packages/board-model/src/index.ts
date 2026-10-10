import * as Y from "yjs"

/**
 * Palette colors an Element can have (GLOSSARY: Palette color, ADR 0008).
 * Elements store the name; each theme maps it to its own shades (DESIGN.md `palette`).
 */
export const PALETTE_COLORS = [
  "ink",
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const
export type PaletteColor = (typeof PALETTE_COLORS)[number]

export function isPaletteColor(value: unknown): value is PaletteColor {
  return typeof value === "string" && (PALETTE_COLORS as readonly string[]).includes(value)
}

// ---------- The Board document ----------
//
// A Board is one Y.Doc with a single root map, "elements": Element id → Y.Map of fields.
// Position and size are each ONE plain value replaced whole, never separate x/y fields,
// so concurrent drags converge on a position someone actually chose (ADR 0002).

export const ELEMENTS = "elements"

export type Point = { x: number; y: number }
export type Size = { w: number; h: number }

/** M0 supports rectangles only; more Element types arrive in M1. */
export type RectElement = {
  type: "rect"
  position: Point
  size: Size
  /** Fractional index for z-order. */
  z: string
  color: PaletteColor
}
export type Element = RectElement

export function elementsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(ELEMENTS)
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const isPoint = (v: unknown): v is Point =>
  typeof v === "object" &&
  v !== null &&
  isFiniteNumber((v as Point).x) &&
  isFiniteNumber((v as Point).y)
const isSize = (v: unknown): v is Size =>
  typeof v === "object" &&
  v !== null &&
  isFiniteNumber((v as Size).w) &&
  isFiniteNumber((v as Size).h) &&
  (v as Size).w >= 0 &&
  (v as Size).h >= 0

/** Reads one Element's fields, or null if they don't form a valid Element. */
export function readElement(fields: Y.Map<unknown>): Element | null {
  const type = fields.get("type")
  const position = fields.get("position")
  const size = fields.get("size")
  const z = fields.get("z")
  const color = fields.get("color")
  if (type !== "rect") return null
  if (!isPoint(position) || !isSize(size)) return null
  if (typeof z !== "string" || z.length === 0) return null
  if (!isPaletteColor(color)) return null
  if (fields.size !== 5) return null
  return { type, position, size, z, color }
}

/**
 * Checks a whole Board document. The board room runs this on a scratch copy before
 * accepting an update, so invalid content never reaches storage or other clients.
 * Returns a list of problems; empty means valid.
 */
export function validateBoardDoc(doc: Y.Doc): string[] {
  const problems: string[] = []
  for (const name of doc.share.keys()) {
    if (name !== ELEMENTS) problems.push(`unexpected root "${name}"`)
  }
  if (!doc.share.has(ELEMENTS)) return problems
  let elements: Y.Map<unknown>
  try {
    elements = doc.getMap(ELEMENTS)
  } catch {
    // "elements" exists but was created as another shared type (array, text…).
    return [...problems, `root "${ELEMENTS}" is not a map`]
  }
  // Root types aren't typed on the wire: list items sent into "elements" would be invisible
  // to the map API but still stored. Yjs keeps list content in `_start`.
  if ((elements as unknown as { _start: unknown })._start !== null) {
    problems.push(`root "${ELEMENTS}" has list content`)
  }
  for (const [id, fields] of elements) {
    if (!(fields instanceof Y.Map)) problems.push(`element ${id} is not a map`)
    else if (!readElement(fields)) problems.push(`element ${id} is invalid`)
  }
  return problems
}
