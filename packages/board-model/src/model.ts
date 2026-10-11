import * as Y from "yjs"

// ---------- Colors (GLOSSARY: Palette color; ADR 0008) ----------

/** Palette colors an Element can have. Elements store the NAME; each theme maps it (DESIGN.md `palette`). */
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

/** Sticky note backgrounds (DESIGN.md `sticky`). Sticky text is always ink. */
export const STICKY_COLORS = ["yellow", "orange", "pink", "violet", "blue", "green"] as const
export type StickyColor = (typeof STICKY_COLORS)[number]

export function isPaletteColor(value: unknown): value is PaletteColor {
  return typeof value === "string" && (PALETTE_COLORS as readonly string[]).includes(value)
}
export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === "string" && (STICKY_COLORS as readonly string[]).includes(value)
}

// ---------- Limits ----------

/** Most Elements a Board may hold (PRD: Limits and quotas). */
export const ELEMENT_CAP = 20_000
/** Most characters in one text or sticky note. */
export const TEXT_LIMIT = 10_000
/** Most points in one pen stroke. */
export const PEN_POINT_LIMIT = 10_000

// ---------- The Board document ----------
//
// One Y.Doc with a single root map, "elements": Element id → Y.Map of fields.
// Geometry values (position, size, pen points, arrow ends, connector ends) are each ONE plain
// value replaced whole, never split into separate fields (ADR 0002). Text is a Y.Text so
// concurrent typing merges (ADR 0009).

export const ELEMENTS = "elements"

export type Point = { x: number; y: number }
export type Size = { w: number; h: number }
export type Fill = "none" | "light" | "solid"
export type PenWidth = "S" | "M" | "L"
export type TextSize = "S" | "M" | "L" | "XL"
export type StickySize = "S" | "M" | "L"
export type TextAlign = "left" | "center" | "right"
export type ConnectorStyle = "straight" | "elbow"
export type Anchor = "top" | "right" | "bottom" | "left"

/** One end of a Connector: attached to an Element's anchor, or free at `fallback`. */
export type ConnectorEnd = { elementId?: string; anchor?: Anchor; fallback: Point }

type Common = {
  /** Fractional index for z-order. */
  z: string
  locked?: boolean
  groupId?: string
}
type Boxed = Common & { position: Point; size: Size }

export type RectElement = Boxed & { type: "rect"; color: PaletteColor; fill: Fill }
export type EllipseElement = Boxed & { type: "ellipse"; color: PaletteColor; fill: Fill }
/** Points are relative to `position`: [x, y, pressure 0–1]. */
export type PenElement = Boxed & {
  type: "pen"
  color: PaletteColor
  width: PenWidth
  points: [number, number, number][]
}
/** `from`/`to` are relative to `position`; the arrowhead is at `to`. */
export type ArrowElement = Boxed & {
  type: "arrow"
  color: PaletteColor
  ends: { from: Point; to: Point }
}
export type ConnectorElement = Common & {
  type: "connector"
  color: PaletteColor
  start: ConnectorEnd
  end: ConnectorEnd
  style: ConnectorStyle
}
export type TextElement = Boxed & {
  type: "text"
  color: PaletteColor
  /** Current content of the Element's Y.Text. */
  text: string
  fontSize: TextSize
  bold: boolean
  align: TextAlign
  /**
   * True: the box is as wide as the longest line and only Enter breaks lines. False: lines
   * wrap at `size.w`. Either way, the drawn height comes from the text's layout; the stored
   * `size` is the last measured box, a hint for anything that can't lay out text.
   */
  autoWidth: boolean
}
export type StickyElement = Boxed & {
  type: "sticky"
  color: StickyColor
  text: string
  fontSize: StickySize
  bold: boolean
}

export type Element =
  | RectElement
  | EllipseElement
  | PenElement
  | ArrowElement
  | ConnectorElement
  | TextElement
  | StickyElement
export type ElementType = Element["type"]
export type BoxedElement = Exclude<Element, ConnectorElement>
export type ElementWithId = Element & { id: string }

export function elementsOf(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(ELEMENTS)
}

export function hasBox(element: Element): element is BoxedElement {
  return element.type !== "connector"
}

// ---------- Reading and validating one Element ----------

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const isPoint = (v: unknown): v is Point =>
  isObject(v) && Object.keys(v).length === 2 && isFiniteNumber(v.x) && isFiniteNumber(v.y)
const isSize = (v: unknown): v is Size =>
  isObject(v) &&
  Object.keys(v).length === 2 &&
  isFiniteNumber(v.w) &&
  isFiniteNumber(v.h) &&
  v.w >= 0 &&
  v.h >= 0
const oneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === "string" && (values as readonly string[]).includes(v)

const isFill = oneOf<Fill>(["none", "light", "solid"])
const isPenWidth = oneOf<PenWidth>(["S", "M", "L"])
const isTextSize = oneOf<TextSize>(["S", "M", "L", "XL"])
const isStickySize = oneOf<StickySize>(["S", "M", "L"])
const isAlign = oneOf<TextAlign>(["left", "center", "right"])
const isConnectorStyle = oneOf<ConnectorStyle>(["straight", "elbow"])
const isAnchor = oneOf<Anchor>(["top", "right", "bottom", "left"])
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64

function isPenPoints(v: unknown): v is [number, number, number][] {
  if (!Array.isArray(v) || v.length === 0 || v.length > PEN_POINT_LIMIT) return false
  return v.every(
    (p) =>
      Array.isArray(p) &&
      p.length === 3 &&
      isFiniteNumber(p[0]) &&
      isFiniteNumber(p[1]) &&
      isFiniteNumber(p[2]) &&
      p[2] >= 0 &&
      p[2] <= 1,
  )
}

function isConnectorEnd(v: unknown): v is ConnectorEnd {
  if (!isObject(v) || !isPoint(v.fallback)) return false
  for (const key of Object.keys(v)) {
    if (key !== "fallback" && key !== "elementId" && key !== "anchor") return false
  }
  if (v.elementId !== undefined && !isId(v.elementId)) return false
  if (v.anchor !== undefined && !isAnchor(v.anchor)) return false
  return true
}

/** Plain text only: no embeds, no formatting, and not a subclass such as Y.XmlText. */
function readText(v: unknown): string | null {
  if (!(v instanceof Y.Text) || v.constructor !== Y.Text || v.length > TEXT_LIMIT) return null
  const delta = v.toDelta() as { insert: unknown; attributes?: unknown }[]
  if (delta.some((op) => typeof op.insert !== "string" || op.attributes !== undefined)) return null
  return v.toString()
}

/** Fields every type may have, beyond its own. */
const OPTIONAL_COMMON = ["locked", "groupId"] as const

/** Each type's allowed fields: required, then optional (with a default when absent). */
const SCHEMA: Record<ElementType, { required: readonly string[]; optional: readonly string[] }> = {
  // v1 rectangles have only type/position/size/z/color, so fill is optional (default "light").
  rect: { required: ["type", "position", "size", "z", "color"], optional: ["fill"] },
  ellipse: { required: ["type", "position", "size", "z", "color", "fill"], optional: [] },
  pen: { required: ["type", "position", "size", "z", "color", "width", "points"], optional: [] },
  arrow: { required: ["type", "position", "size", "z", "color", "ends"], optional: [] },
  connector: { required: ["type", "z", "color", "start", "end", "style"], optional: [] },
  text: {
    required: ["type", "position", "size", "z", "color", "text", "fontSize", "bold", "align"],
    optional: ["autoWidth"],
  },
  sticky: {
    required: ["type", "position", "size", "z", "color", "text", "fontSize", "bold"],
    optional: [],
  },
}

function hasOnlyKnownFields(fields: Y.Map<unknown>, type: ElementType): boolean {
  const { required, optional } = SCHEMA[type]
  for (const key of required) if (!fields.has(key)) return false
  for (const key of fields.keys()) {
    if (
      !required.includes(key) &&
      !optional.includes(key) &&
      !(OPTIONAL_COMMON as readonly string[]).includes(key)
    ) {
      return false
    }
  }
  return true
}

/** Reads one Element's fields, or null if they don't form a valid Element. */
export function readElement(fields: Y.Map<unknown>): Element | null {
  const type = fields.get("type")
  if (typeof type !== "string" || !(type in SCHEMA)) return null
  if (!hasOnlyKnownFields(fields, type as ElementType)) return null

  const z = fields.get("z")
  if (typeof z !== "string" || z.length === 0) return null
  const locked = fields.get("locked")
  if (locked !== undefined && typeof locked !== "boolean") return null
  const groupId = fields.get("groupId")
  if (groupId !== undefined && !isId(groupId)) return null
  const common: Common = {
    z,
    ...(locked !== undefined ? { locked } : {}),
    ...(groupId !== undefined ? { groupId } : {}),
  }

  const color = fields.get("color")

  if (type === "connector") {
    const start = fields.get("start")
    const end = fields.get("end")
    const style = fields.get("style")
    if (!isPaletteColor(color) || !isConnectorEnd(start) || !isConnectorEnd(end)) return null
    if (!isConnectorStyle(style)) return null
    return { ...common, type, color, start, end, style }
  }

  const position = fields.get("position")
  const size = fields.get("size")
  if (!isPoint(position) || !isSize(size)) return null
  const boxed = { ...common, position, size }

  switch (type) {
    case "rect":
    case "ellipse": {
      const fill = fields.get("fill") ?? "light"
      if (!isPaletteColor(color) || !isFill(fill)) return null
      return { ...boxed, type, color, fill }
    }
    case "pen": {
      const width = fields.get("width")
      const points = fields.get("points")
      if (!isPaletteColor(color) || !isPenWidth(width) || !isPenPoints(points)) return null
      return { ...boxed, type, color, width, points }
    }
    case "arrow": {
      const ends = fields.get("ends")
      if (!isPaletteColor(color) || !isObject(ends) || Object.keys(ends).length !== 2) return null
      if (!isPoint(ends.from) || !isPoint(ends.to)) return null
      return { ...boxed, type, color, ends: { from: ends.from, to: ends.to } }
    }
    case "text": {
      const text = readText(fields.get("text"))
      const fontSize = fields.get("fontSize")
      const bold = fields.get("bold")
      const align = fields.get("align")
      if (!isPaletteColor(color) || text === null || !isTextSize(fontSize)) return null
      if (typeof bold !== "boolean" || !isAlign(align)) return null
      const autoWidth = fields.get("autoWidth") ?? false
      if (typeof autoWidth !== "boolean") return null
      return { ...boxed, type, color, text, fontSize, bold, align, autoWidth }
    }
    case "sticky": {
      const text = readText(fields.get("text"))
      const fontSize = fields.get("fontSize")
      const bold = fields.get("bold")
      if (!isStickyColor(color) || text === null || !isStickySize(fontSize)) return null
      if (typeof bold !== "boolean") return null
      return { ...boxed, type, color, text, fontSize, bold }
    }
  }
  return null
}

// ---------- Validating a whole Board ----------

/**
 * Checks a whole Board document. The board room runs this on a scratch copy before accepting
 * an update, so invalid content never reaches storage or other clients. Returns a list of
 * problems; empty means valid. `elementCap` is overridable for tests only.
 */
export function validateBoardDoc(doc: Y.Doc, options: { elementCap?: number } = {}): string[] {
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
  const cap = options.elementCap ?? ELEMENT_CAP
  if (elements.size > cap) problems.push(`more than ${cap} elements`)
  for (const [id, fields] of elements) {
    if (!(fields instanceof Y.Map)) problems.push(`element ${id} is not a map`)
    else if (!readElement(fields)) problems.push(`element ${id} is invalid`)
  }
  return problems
}

/** All valid Elements, bottom to top (z-order). Invalid entries are skipped. */
export function listElements(doc: Y.Doc): ElementWithId[] {
  const out: ElementWithId[] = []
  for (const [id, fields] of elementsOf(doc)) {
    if (!(fields instanceof Y.Map)) continue
    const element = readElement(fields)
    if (element) out.push({ ...element, id })
  }
  return out.sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1))
}
