import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  type ArrangeUnit,
  addShape,
  alignUnits,
  type BoxOf,
  distributeUnits,
  elementsOf,
  isOrderKey,
  listElements,
  reorderElements,
  validateBoardDoc,
} from "./index"

const boxOf: BoxOf = (e) =>
  "position" in e ? { x: e.position.x, y: e.position.y, w: e.size.w, h: e.size.h } : null

/** Rects drawn in order (bottom to top); `x` positions, all 10 wide and overlapping in y. */
function board(...xs: number[]) {
  const doc = new Y.Doc()
  const ids = xs.map((x) =>
    addShape(doc, { type: "rect", position: { x, y: 0 }, size: { w: 10, h: 10 } }, "me"),
  )
  const order = () => listElements(doc).map((e) => ids.indexOf(e.id))
  return { doc, ids, order }
}

describe("reorderElements", () => {
  it("brings forward one step past the next overlapping Element", () => {
    // 0 and 2 overlap (x 0 and 5); 1 is far away, so it's skipped.
    const { doc, ids, order } = board(0, 100, 5, 8)
    expect(reorderElements(doc, [ids[0] as string], "forward", boxOf, "me")).toBe(true)
    expect(order()).toEqual([1, 2, 0, 3])
  })

  it("sends backward one step, keeping a multi-selection's own order", () => {
    const { doc, ids, order } = board(0, 3, 6, 9)
    reorderElements(doc, [ids[2] as string, ids[3] as string], "backward", boxOf, "me")
    expect(order()).toEqual([0, 2, 3, 1])
  })

  it("does nothing with nothing overlapping in the way", () => {
    const { doc, ids, order } = board(0, 100)
    expect(reorderElements(doc, [ids[0] as string], "forward", boxOf, "me")).toBe(false)
    expect(order()).toEqual([0, 1])
  })

  it("reorders past Elements sharing a z key (left by concurrent edits)", () => {
    const { doc, ids, order } = board(0, 3, 6)
    const elements = elementsOf(doc)
    elements.get(ids[2] as string)?.set("z", elements.get(ids[1] as string)?.get("z"))
    const tiedOrder = order()
    const [bottom] = tiedOrder
    reorderElements(doc, [ids[bottom as number] as string], "forward", boxOf, "me")
    expect(order()[0]).not.toBe(bottom)
    expect(listElements(doc)).toHaveLength(3)
    expect(validateBoardDoc(doc)).toEqual([])
  })
})

describe("order keys", () => {
  it("accepts generated keys and refuses malformed ones", () => {
    expect(isOrderKey("a0")).toBe(true)
    expect(isOrderKey("a0V")).toBe(true)
    expect(isOrderKey("a")).toBe(false) // missing its integer digit
    expect(isOrderKey("a00")).toBe(false) // trailing zero
    expect(isOrderKey("")).toBe(false)
    expect(isOrderKey("a0".padEnd(200, "V"))).toBe(false)
  })

  it("refuses a Board holding a malformed key", () => {
    const { doc, ids } = board(0)
    elementsOf(doc)
      .get(ids[0] as string)
      ?.set("z", "zzz")
    expect(validateBoardDoc(doc)).toEqual([`element ${ids[0]} is invalid`])
  })
})

const unit = (x: number, y: number, w: number, h: number): ArrangeUnit => ({
  ids: [],
  box: { x, y, w, h },
})

describe("alignUnits", () => {
  const units = [unit(0, 0, 10, 10), unit(40, 20, 20, 30)]
  it.each([
    ["left", [[1, { x: -40, y: 0 }]]],
    ["right", [[0, { x: 50, y: 0 }]]],
    [
      "center",
      [
        [0, { x: 25, y: 0 }],
        [1, { x: -20, y: 0 }],
      ],
    ],
    ["top", [[1, { x: 0, y: -20 }]]],
    ["bottom", [[0, { x: 0, y: 40 }]]],
    [
      "middle",
      [
        [0, { x: 0, y: 20 }],
        [1, { x: 0, y: -10 }],
      ],
    ],
  ] as const)("aligns %s", (alignment, expected) => {
    expect([...alignUnits(units, alignment)]).toEqual(expected)
  })
})

describe("distributeUnits", () => {
  it("makes the gaps equal, keeping the outer units in place", () => {
    // Spans 0–100 with widths 10 + 30 + 20: gaps of 20.
    const units = [unit(0, 0, 10, 5), unit(80, 0, 20, 5), unit(15, 0, 30, 5)]
    expect([...distributeUnits(units, "horizontal")]).toEqual([[2, { x: 15, y: 0 }]])
  })

  it("needs three or more", () => {
    expect(distributeUnits([unit(0, 0, 1, 1), unit(5, 0, 1, 1)], "vertical").size).toBe(0)
  })
})
