import type * as Y from "yjs"
import { type ElementWithId, imageBoardOf, type Point, type Size } from "./model"
import { addElement } from "./ops"

// ---------- Images (M5b ticket 03; DESIGN.md → Images) ----------

/** A new image fits within this many canvas units on its longer side. */
export const IMAGE_FIT = 480
/** Space between images added together, laid out in a row. */
export const IMAGE_GAP = 16

/** The size a new image arrives at: its natural size, shrunk to fit within IMAGE_FIT. */
export function fittedSize(natural: Size, fit = IMAGE_FIT): Size {
  const k = Math.min(1, fit / Math.max(natural.w, natural.h, 1))
  return { w: Math.max(1, Math.round(natural.w * k)), h: Math.max(1, Math.round(natural.h * k)) }
}

/**
 * Where images added together go: a row with IMAGE_GAP between them, centered on `at`, their
 * tops aligned. Returns each box's top-left corner.
 */
export function imageRow(sizes: readonly Size[], at: Point): Point[] {
  const width = sizes.reduce((sum, s) => sum + s.w, 0) + IMAGE_GAP * Math.max(0, sizes.length - 1)
  const height = Math.max(0, ...sizes.map((s) => s.h))
  let x = at.x - width / 2
  return sizes.map((s) => {
    const position = { x, y: at.y - height / 2 }
    x += s.w + IMAGE_GAP
    return position
  })
}

/** Adds an image Element for an uploaded file (one undo step). Returns the new id. */
export function addImage(
  doc: Y.Doc,
  image: { key: string; natural: Size; position: Point; size: Size },
  origin: unknown,
): string {
  return addElement(
    doc,
    {
      type: "image",
      key: image.key,
      natural: { w: image.natural.w, h: image.natural.h },
      position: { x: image.position.x, y: image.position.y },
      size: { w: image.size.w, h: image.size.h },
    },
    origin,
  )
}

/** Image keys among `elements` whose files belong to another Board than `boardId`. */
export function foreignImageKeys(elements: readonly ElementWithId[], boardId: string): string[] {
  const keys = new Set<string>()
  for (const e of elements) {
    if (e.type === "image" && imageBoardOf(e.key) !== boardId) keys.add(e.key)
  }
  return [...keys]
}

/**
 * The Elements with image keys swapped as `keys` says (copies uploaded to this Board). An
 * image whose key has no copy is dropped, so a paste never leaves a picture nobody here can see.
 */
export function remapImageKeys(
  elements: readonly ElementWithId[],
  boardId: string,
  keys: ReadonlyMap<string, string>,
): ElementWithId[] {
  return elements.flatMap((e) => {
    if (e.type !== "image" || imageBoardOf(e.key) === boardId) return [e]
    const key = keys.get(e.key)
    return key ? [{ ...e, key }] : []
  })
}
