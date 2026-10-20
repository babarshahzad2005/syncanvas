import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  addImage,
  type ElementWithId,
  fittedSize,
  foreignImageKeys,
  IMAGE_GAP,
  imageBoardOf,
  imageRow,
  listElements,
  recolorElement,
  remapImageKeys,
  scaledGeometry,
  validateBoardDoc,
} from "./index"

// Images on the canvas (M5b ticket 03): arriving sizes, rows, resizing, and copies between Boards.

const keyOn = (boardId: string, n = 1) =>
  `images/${boardId}/0b9c1a2e-3f4d-4e5a-9b6c-7d8e9f0a1b2${n}`

function image(id: string, key: string, natural = { w: 400, h: 200 }): ElementWithId {
  return { id, type: "image", key, natural, position: { x: 0, y: 0 }, size: natural, z: "a0" }
}

describe("adding images", () => {
  it("fits a new image within 480 units, keeping its proportions", () => {
    expect(fittedSize({ w: 1920, h: 1080 })).toEqual({ w: 480, h: 270 })
    expect(fittedSize({ w: 600, h: 1200 })).toEqual({ w: 240, h: 480 })
    // Small ones stay their own size.
    expect(fittedSize({ w: 120, h: 80 })).toEqual({ w: 120, h: 80 })
  })

  it("lays several out in a row centered on the drop point", () => {
    const row = imageRow(
      [
        { w: 100, h: 50 },
        { w: 200, h: 100 },
      ],
      { x: 0, y: 0 },
    )
    const width = 300 + IMAGE_GAP
    expect(row).toEqual([
      { x: -width / 2, y: -50 },
      { x: -width / 2 + 100 + IMAGE_GAP, y: -50 },
    ])
  })

  it("writes a valid image Element that takes no color", () => {
    const doc = new Y.Doc()
    const id = addImage(
      doc,
      {
        key: keyOn("b1"),
        natural: { w: 1600, h: 900 },
        position: { x: 10, y: 20 },
        size: { w: 480, h: 270 },
      },
      "me",
    )
    recolorElement(doc, id, "red", "me")
    expect(validateBoardDoc(doc)).toEqual([])
    expect(listElements(doc)[0]).toMatchObject({ id, type: "image", key: keyOn("b1") })
    expect(imageBoardOf(keyOn("b1"))).toBe("b1")
  })
})

describe("resizing an image", () => {
  it("keeps its proportions whatever the box does", () => {
    const e = image("i", keyOn("b1"))
    const from = { x: 0, y: 0, w: 400, h: 200 }
    // Dragged wider and flatter: the height still follows the width.
    expect(scaledGeometry(e, from, { x: 0, y: 0, w: 800, h: 100 }, true)).toEqual({
      position: { x: 0, y: 0 },
      size: { w: 800, h: 400 },
    })
  })
})

describe("pasting into another Board", () => {
  const here = "board-here"
  const there = "board-there"

  it("finds the images that belong to another Board, once each", () => {
    const elements = [
      image("a", keyOn(there, 1)),
      image("b", keyOn(there, 1)),
      image("c", keyOn(here, 2)),
    ]
    expect(foreignImageKeys(elements, here)).toEqual([keyOn(there, 1)])
  })

  it("swaps in the copies' keys, and drops images that couldn't be copied", () => {
    const rect: ElementWithId = {
      id: "r",
      type: "rect",
      position: { x: 0, y: 0 },
      size: { w: 1, h: 1 },
      z: "a0",
      color: "ink",
      fill: "none",
    }
    const elements = [
      image("a", keyOn(there, 1)),
      image("b", keyOn(there, 2)),
      image("c", keyOn(here, 3)),
      rect,
    ]
    const copied = new Map([[keyOn(there, 1), keyOn(here, 4)]])
    expect(remapImageKeys(elements, here, copied).map((e) => [e.id, "key" in e && e.key])).toEqual([
      ["a", keyOn(here, 4)],
      ["c", keyOn(here, 3)],
      ["r", false],
    ])
  })
})
