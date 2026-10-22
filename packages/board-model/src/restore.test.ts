import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  addConnector,
  addImage,
  addRect,
  addSticky,
  applyRestore,
  createUndoManager,
  deleteElements,
  listElements,
  moveElement,
  restoreDiff,
  textOf,
  validateBoardDoc,
} from "./index"

// Restoring a Version (M5b ticket 07): the difference from now, as one undoable edit.

const ME = { tab: "me" }

/** A copy of the doc as it is now, the way a Version's state comes back from the room. */
function versionOf(doc: Y.Doc) {
  const copy = new Y.Doc()
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
  return copy
}

function board() {
  const doc = new Y.Doc()
  const a = addRect(doc, { position: { x: 0, y: 0 }, size: { w: 100, h: 50 } }, "setup")
  const b = addSticky(doc, { center: { x: 300, y: 0 }, content: "Keep this" }, "setup")
  const c = addConnector(
    doc,
    {
      start: { elementId: a, anchor: "right", fallback: { x: 100, y: 25 } },
      end: { elementId: b, anchor: "left", fallback: { x: 200, y: 0 } },
      style: "straight",
    },
    "setup",
  )
  const image = addImage(
    doc,
    {
      key: "images/b1/0b9c1a2e-3f4d-4e5a-9b6c-7d8e9f0a1b2c",
      natural: { w: 800, h: 600 },
      position: { x: 0, y: 200 },
      size: { w: 400, h: 300 },
    },
    "setup",
  )
  return { doc, a, b, c, image }
}

describe("restoreDiff", () => {
  it("finds what was added, changed, and removed since the Version", () => {
    const { doc, a, b } = board()
    const version = versionOf(doc)
    moveElement(doc, a, { x: 50, y: 50 }, "setup")
    deleteElements(doc, [b], "setup")
    const extra = addRect(doc, { position: { x: 9, y: 9 }, size: { w: 1, h: 1 } }, "setup")
    const diff = restoreDiff(doc, version)
    expect(diff.added.map((e) => e.id)).toEqual([b])
    expect(diff.changed.map((e) => e.id)).toEqual([a])
    expect(diff.removed).toEqual([extra])
  })

  it("is empty when nothing changed", () => {
    const { doc } = board()
    expect(restoreDiff(doc, versionOf(doc))).toEqual({ added: [], changed: [], removed: [] })
  })
})

describe("applyRestore", () => {
  it("brings the Board back to the Version, connectors and image keys intact, in one undo step", () => {
    const { doc, a, b, c } = board()
    const version = versionOf(doc)
    const before = JSON.stringify(listElements(doc))
    // Changes since: a move, a deleted note (its connector end falls back), a text edit, a new rect.
    moveElement(doc, a, { x: 50, y: 50 }, "setup")
    textOf(doc, b)?.insert(0, "Edited: ")
    deleteElements(doc, [b], "setup")
    addRect(doc, { position: { x: 9, y: 9 }, size: { w: 1, h: 1 } }, "setup")
    const edited = JSON.stringify(listElements(doc))

    const undo = createUndoManager(doc, ME)
    applyRestore(doc, version, ME)
    expect(JSON.stringify(listElements(doc))).toBe(before)
    expect(validateBoardDoc(doc)).toEqual([])
    const connector = listElements(doc).find((e) => e.id === c)
    expect(connector?.type === "connector" && connector.end.elementId).toBe(b)
    expect(listElements(doc).find((e) => e.type === "image")).toMatchObject({
      key: "images/b1/0b9c1a2e-3f4d-4e5a-9b6c-7d8e9f0a1b2c",
    })

    undo.undo()
    expect(JSON.stringify(listElements(doc))).toBe(edited)
    expect(undo.undoStack).toHaveLength(0)
  })
})
