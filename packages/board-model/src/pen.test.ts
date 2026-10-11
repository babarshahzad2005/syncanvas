import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  addPen,
  listElements,
  PEN_POINT_LIMIT,
  type StrokePoint,
  setPenWidth,
  simplifyStroke,
  validateBoardDoc,
} from "./index"

describe("simplifyStroke", () => {
  it("drops points on a straight line but keeps the ends", () => {
    const line: StrokePoint[] = [0, 1, 2, 3, 4].map((x) => [x * 10, 0, 0.5])
    expect(simplifyStroke(line, 0.5)).toEqual([
      [0, 0, 0.5],
      [40, 0, 0.5],
    ])
  })

  it("keeps the corners of a bend", () => {
    const bend: StrokePoint[] = [
      [0, 0, 0.5],
      [5, 0, 0.5],
      [10, 0, 0.5],
      [10, 5, 0.5],
      [10, 10, 0.5],
    ]
    expect(simplifyStroke(bend, 0.5)).toEqual([
      [0, 0, 0.5],
      [10, 0, 0.5],
      [10, 10, 0.5],
    ])
  })
})

describe("addPen", () => {
  it("stores points relative to the stroke's box, as one valid Element", () => {
    const doc = new Y.Doc()
    const id = addPen(
      doc,
      {
        points: [
          [100, 50, 0.2],
          [130, 90, 0.8],
          [110, 70.123, 1.4],
        ],
        color: "blue",
        width: "L",
        tolerance: 0,
      },
      "me",
    )
    expect(listElements(doc)).toEqual([
      expect.objectContaining({
        id,
        type: "pen",
        position: { x: 100, y: 50 },
        size: { w: 30, h: 40 },
        color: "blue",
        width: "L",
        points: [
          [0, 0, 0.2],
          [30, 40, 0.8],
          [10, 20.12, 1], // rounded, pressure clamped
        ],
      }),
    ])
    expect(validateBoardDoc(doc)).toEqual([])
  })

  it("keeps a very long stroke under the point limit", () => {
    const doc = new Y.Doc()
    const zigzag: StrokePoint[] = Array.from({ length: PEN_POINT_LIMIT * 3 }, (_, i) => [
      i,
      i % 2 === 0 ? 0 : 3,
      0.5,
    ])
    addPen(doc, { points: zigzag, color: "ink", width: "S", tolerance: 0 }, "me")
    const [stroke] = listElements(doc)
    expect(stroke?.type === "pen" && stroke.points.length).toBeLessThanOrEqual(PEN_POINT_LIMIT)
    expect(validateBoardDoc(doc)).toEqual([])
  })

  it("writes nothing for an empty stroke, and a dot for a tap", () => {
    const doc = new Y.Doc()
    expect(addPen(doc, { points: [], color: "ink", width: "M", tolerance: 1 }, "me")).toBeNull()
    addPen(doc, { points: [[5, 5, 0.5]], color: "ink", width: "M", tolerance: 1 }, "me")
    expect(listElements(doc)[0]).toMatchObject({ size: { w: 0, h: 0 }, points: [[0, 0, 0.5]] })
    expect(validateBoardDoc(doc)).toEqual([])
  })

  it("changes width", () => {
    const doc = new Y.Doc()
    const id = addPen(
      doc,
      { points: [[0, 0, 0.5]], color: "ink", width: "M", tolerance: 1 },
      "me",
    ) as string
    setPenWidth(doc, id, "S", "me")
    expect(listElements(doc)[0]).toMatchObject({ width: "S" })
  })
})
