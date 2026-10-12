import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  addArrow,
  addPen,
  addShape,
  addSticky,
  addText,
  listElements,
  MIN_STICKY_WIDTH,
  scaledGeometry,
  setGeometry,
  validateBoardDoc,
} from "./index"

const box = { x: 0, y: 0, w: 100, h: 100 }
const doubled = { x: 0, y: 0, w: 200, h: 200 }

function scaleAll(doc: Y.Doc, from: typeof box, to: typeof box) {
  const all = listElements(doc)
  setGeometry(
    doc,
    all.flatMap((e) => {
      const g = scaledGeometry(e, from, to, all.length === 1)
      return g ? [[e.id, g] as const] : []
    }),
    "me",
  )
  return listElements(doc)
}

describe("scaledGeometry", () => {
  it("scales shapes around the box corner", () => {
    const doc = new Y.Doc()
    addShape(doc, { type: "rect", position: { x: 50, y: 20 }, size: { w: 10, h: 30 } }, "me")
    const [rect] = scaleAll(doc, box, { x: 10, y: 10, w: 200, h: 50 })
    expect(rect).toMatchObject({ position: { x: 110, y: 20 }, size: { w: 20, h: 15 } })
  })

  it("scales pen points and arrow ends with their box", () => {
    const doc = new Y.Doc()
    addPen(
      doc,
      {
        points: [
          [0, 0, 0.5],
          [50, 100, 0.7],
        ],
        color: "ink",
        width: "M",
        tolerance: 0,
      },
      "me",
    )
    addArrow(doc, { from: { x: 100, y: 0 }, to: { x: 0, y: 100 } }, "me")
    const [pen, arrow] = scaleAll(doc, box, doubled)
    expect(pen?.type === "pen" && pen.points).toEqual([
      [0, 0, 0.5],
      [100, 200, 0.7],
    ])
    expect(arrow?.type === "arrow" && arrow.ends).toEqual({
      from: { x: 200, y: 0 },
      to: { x: 0, y: 200 },
    })
    expect(validateBoardDoc(doc)).toEqual([])
  })

  it("changes a text's width, not its font, and fixes an auto width when resized alone", () => {
    const doc = new Y.Doc()
    addText(doc, { position: { x: 0, y: 0 }, width: null, lineHeight: 26, content: "hi" }, "me")
    const [text] = scaleAll(doc, { x: 0, y: 0, w: 40, h: 26 }, { x: 0, y: 0, w: 150, h: 99 })
    expect(text).toMatchObject({ autoWidth: false, size: { w: 150, h: 26 }, fontSize: "M" })
  })

  it("only moves auto-width text in a multi-selection", () => {
    const doc = new Y.Doc()
    addText(doc, { position: { x: 50, y: 50 }, width: null, lineHeight: 26 }, "me")
    addShape(doc, { type: "rect", position: { x: 0, y: 0 }, size: { w: 10, h: 10 } }, "me")
    const [text] = scaleAll(doc, box, doubled)
    expect(text).toMatchObject({ position: { x: 100, y: 100 }, autoWidth: true })
  })

  it("keeps sticky notes square-based and no narrower than the minimum", () => {
    const doc = new Y.Doc()
    addSticky(doc, { center: { x: 100, y: 100 } }, "me")
    const [sticky] = scaleAll(doc, { x: 0, y: 0, w: 200, h: 200 }, { x: 0, y: 0, w: 10, h: 300 })
    expect(sticky?.type === "sticky" && sticky.size).toEqual({
      w: MIN_STICKY_WIDTH,
      h: MIN_STICKY_WIDTH,
    })
  })
})
