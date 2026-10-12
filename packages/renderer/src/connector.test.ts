import type { ElementWithId } from "@syncanvas/board-model"
import { describe, expect, it } from "vitest"
import { connectorPath, hitTest, snapPoints } from "./index"

describe("connectorPath", () => {
  const a = { x: 0, y: 0 }
  const b = { x: 100, y: 50 }

  it("draws straight connectors as one segment", () => {
    expect(connectorPath(a, "right", b, "left", "straight")).toEqual([a, b])
  })

  it("routes side to opposite side in three segments, turning halfway", () => {
    expect(connectorPath(a, "right", b, "left", "elbow")).toEqual([
      a,
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      b,
    ])
    expect(connectorPath(a, "bottom", b, "top", "elbow")).toEqual([
      a,
      { x: 0, y: 25 },
      { x: 100, y: 25 },
      b,
    ])
  })

  it("routes side to a perpendicular side in two segments", () => {
    expect(connectorPath(a, "right", b, "top", "elbow")).toEqual([a, { x: 100, y: 0 }, b])
    expect(connectorPath(a, "bottom", b, "left", "elbow")).toEqual([a, { x: 0, y: 50 }, b])
  })

  it("leads free ends along the longer axis, and drops zero-length segments", () => {
    expect(connectorPath(a, undefined, b, undefined, "elbow")).toEqual([
      a,
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      b,
    ])
    expect(connectorPath(a, "right", { x: 100, y: 0 }, "left", "elbow")).toEqual([
      a,
      { x: 100, y: 0 },
    ])
  })
})

describe("connectors on the canvas", () => {
  const rect = (id: string, x: number): ElementWithId => ({
    id,
    type: "rect",
    position: { x, y: 0 },
    size: { w: 100, h: 100 },
    z: `a${id}`,
    color: "ink",
    fill: "light",
  })
  const elbow: ElementWithId = {
    id: "c",
    type: "connector",
    z: "a9",
    color: "ink",
    start: { elementId: "1", anchor: "bottom", fallback: { x: 0, y: 0 } },
    end: { elementId: "2", anchor: "bottom", fallback: { x: 0, y: 0 } },
    style: "elbow",
  }

  it("hits along the elbow's segments, not the straight line between its ends", () => {
    const elements = [rect("1", 0), rect("2", 300), elbow]
    // Bottom midpoints (50, 100) and (350, 100): the elbow dips to y = 100 (same height).
    expect(hitTest(elements, { x: 200, y: 100 }, 1)).toBe("c")
    expect(hitTest(elements, { x: 200, y: 60 }, 1)).toBeNull()
  })

  it("offers the four side midpoints of shapes, text, and stickies, not of lines", () => {
    expect(snapPoints(rect("1", 0)).map((s) => s.point)).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 50 },
    ])
    expect(snapPoints(elbow)).toEqual([])
  })
})
