import * as Y from "yjs"
import { cleanStaleGroups } from "./groups"
import {
  elementsOf,
  type PaletteColor,
  type Point,
  type Size,
  type StickyColor,
  type StickySize,
  type TextAlign,
  type TextSize,
} from "./model"
import { addElement } from "./ops"

// ---------- Text (ADR 0009) ----------
//
// Text and sticky note content is a Y.Text, so two people typing in the same note merge
// character by character. The editor turns each change of its textarea into the smallest
// delete + insert (`applyTextChange`), and remote changes arrive as Y.Text deltas.

/** Adds an empty text Element. `width` null means auto width (grows as you type). */
export function addText(
  doc: Y.Doc,
  text: {
    position: Point
    width: number | null
    /** Height of one empty line, so the stored box is sensible before anything is typed. */
    lineHeight: number
    color?: PaletteColor
    fontSize?: TextSize
    bold?: boolean
    align?: TextAlign
    content?: string
  },
  origin: unknown,
): string {
  return addElement(
    doc,
    {
      type: "text",
      position: text.position,
      size: { w: text.width ?? 0, h: text.lineHeight },
      color: text.color ?? "ink",
      text: text.content ?? "",
      fontSize: text.fontSize ?? "M",
      bold: text.bold ?? false,
      align: text.align ?? "left",
      autoWidth: text.width === null,
    },
    origin,
  )
}

/** Width of a new sticky note; it starts square and grows taller as text is added. */
export const STICKY_SIZE = 200

/** Adds a sticky note of the default size, centered on `center`. */
export function addSticky(
  doc: Y.Doc,
  sticky: {
    center: Point
    color?: StickyColor
    fontSize?: StickySize
    bold?: boolean
    content?: string
  },
  origin: unknown,
): string {
  return addElement(
    doc,
    {
      type: "sticky",
      position: { x: sticky.center.x - STICKY_SIZE / 2, y: sticky.center.y - STICKY_SIZE / 2 },
      size: { w: STICKY_SIZE, h: STICKY_SIZE },
      color: sticky.color ?? "yellow",
      text: sticky.content ?? "",
      fontSize: sticky.fontSize ?? "M",
      bold: sticky.bold ?? false,
    },
    origin,
  )
}

/** The Y.Text of a text or sticky note, if the Element exists and has one. */
export function textOf(doc: Y.Doc, id: string): Y.Text | undefined {
  const text = elementsOf(doc).get(id)?.get("text")
  return text instanceof Y.Text ? text : undefined
}

/**
 * The smallest edit turning `before` into `after`: one delete and one insert at the first
 * difference. Typing, deleting, and pasting each produce exactly that shape.
 */
export function diffText(
  before: string,
  after: string,
): { index: number; remove: number; insert: string } {
  let start = 0
  const max = Math.min(before.length, after.length)
  while (start < max && before[start] === after[start]) start++
  let end = 0
  while (end < max - start && before[before.length - 1 - end] === after[after.length - 1 - end]) {
    end++
  }
  // Never cut through a surrogate pair (emoji and other non-BMP characters): Yjs would
  // replace the orphaned half with "�".
  const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff
  if (start > 0 && (isLow(before.charCodeAt(start)) || isLow(after.charCodeAt(start)))) start--
  if (
    end > 0 &&
    (isLow(before.charCodeAt(before.length - end)) || isLow(after.charCodeAt(after.length - end)))
  ) {
    end--
  }
  return {
    index: start,
    remove: before.length - start - end,
    insert: after.slice(start, after.length - end),
  }
}

/** Applies the change from `before` to `after` to the Y.Text, as one transaction. */
export function applyTextChange(
  text: Y.Text,
  before: string,
  after: string,
  origin: unknown,
): void {
  const { index, remove, insert } = diffText(before, after)
  if (remove === 0 && insert === "") return
  const doc = text.doc
  const apply = () => {
    if (remove > 0) text.delete(index, remove)
    if (insert) text.insert(index, insert)
  }
  if (doc) doc.transact(apply, origin)
  else apply()
}

/**
 * Where a caret at `index` ends up after a remote change described by a Y.Text delta.
 * Text inserted before the caret pushes it right; text inserted exactly at the caret lands
 * after it, so the caret stays where the person left it.
 */
export function transformIndex(
  index: number,
  delta: readonly { retain?: number; insert?: unknown; delete?: number }[],
): number {
  let position = 0 // in the old text
  let shifted = index
  for (const op of delta) {
    if (op.retain !== undefined) {
      position += op.retain
    } else if (op.insert !== undefined) {
      const length = typeof op.insert === "string" ? op.insert.length : 1
      if (position < index) shifted += length
    } else if (op.delete !== undefined) {
      if (position < index) shifted -= Math.min(op.delete, index - position)
      position += op.delete
    }
    if (position > index) break
  }
  return Math.max(0, shifted)
}

export function setTextStyle(
  doc: Y.Doc,
  id: string,
  style: { fontSize?: TextSize; bold?: boolean; align?: TextAlign },
  origin: unknown,
) {
  const fields = elementsOf(doc).get(id)
  const type = fields?.get("type")
  if (!fields || (type !== "text" && type !== "sticky")) return
  doc.transact(() => {
    // Stickies have no XL (and no alignment).
    if (style.fontSize !== undefined && (type === "text" || style.fontSize !== "XL")) {
      fields.set("fontSize", style.fontSize)
    }
    if (style.bold !== undefined) fields.set("bold", style.bold)
    if (style.align !== undefined && type === "text") fields.set("align", style.align)
    cleanStaleGroups(doc, [id])
  }, origin)
}

/** Records a measured box (whole value, ADR 0002). Skips the write when nothing changed. */
export function setSize(doc: Y.Doc, id: string, size: Size, origin: unknown) {
  const fields = elementsOf(doc).get(id)
  const current = fields?.get("size") as Size | undefined
  if (!fields || (current && current.w === size.w && current.h === size.h)) return
  doc.transact(() => fields.set("size", { w: size.w, h: size.h }), origin)
}
