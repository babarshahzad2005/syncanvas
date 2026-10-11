import type { ElementWithId } from "@syncanvas/board-model"
import { describe, expect, it } from "vitest"
import { ElementIndex, hitTest } from "./index"

const rect = (id: string, x: number, y: number, z = id): ElementWithId => ({
  id,
  type: "rect",
  position: { x, y },
  size: { w: 10, h: 10 },
  z,
  color: "ink",
  fill: "light",
})
const ids = (elements: readonly ElementWithId[]) => elements.map((e) => e.id)

describe("ElementIndex", () => {
  it("finds what touches a rect, in drawing order", () => {
    const index = new ElementIndex([rect("b", 0, 0), rect("a", 5, 5), rect("c", 500, 500)])
    expect(ids(index.query({ x: 0, y: 0, w: 20, h: 20 }))).toEqual(["a", "b"])
  })

  it("selects only what lies entirely inside a marquee, dragged either way", () => {
    const index = new ElementIndex([rect("a", 0, 0), rect("b", 15, 0)])
    expect(index.inside({ x: -1, y: -1, w: 20, h: 20 })).toEqual(["a"])
    expect(index.inside({ x: 30, y: 30, w: -31, h: -31 }).sort()).toEqual(["a", "b"])
  })

  it("follows moves, deletes, and z changes", () => {
    const index = new ElementIndex([rect("a", 0, 0, "a0"), rect("b", 0, 0, "a1")])
    index.update([["a", rect("a", 100, 100, "a0")]])
    expect(ids(index.query({ x: 0, y: 0, w: 20, h: 20 }))).toEqual(["b"])
    index.update([["a", rect("a", 0, 0, "a2")]])
    expect(ids(index.all())).toEqual(["b", "a"])
    index.update([["b", null]])
    expect(ids(index.all())).toEqual(["a"])
    expect(index.size).toBe(1)
  })

  it("always returns connectors, which follow what they attach to", () => {
    const connector: ElementWithId = {
      id: "k",
      type: "connector",
      z: "a5",
      color: "ink",
      start: { fallback: { x: 900, y: 900 } },
      end: { fallback: { x: 950, y: 950 } },
      style: "straight",
    }
    const index = new ElementIndex([rect("a", 0, 0), connector])
    expect(ids(index.query({ x: 0, y: 0, w: 1, h: 1 }))).toEqual(["a", "k"])
    expect(index.inside({ x: 890, y: 890, w: 100, h: 100 })).toEqual(["k"])
  })

  it("stays fast on a Board at the Element cap", () => {
    const many = Array.from({ length: 20_000 }, (_, i) =>
      rect(`e${i}`, (i % 200) * 20, Math.floor(i / 200) * 20, `z${i}`),
    )
    const index = new ElementIndex(many)
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      const nearby = index.query({ x: 1000 + i, y: 1000, w: 4, h: 4 })
      hitTest(nearby, { x: 1002 + i, y: 1002 }, 1, index.byId)
      index.update([[`e${i}`, rect(`e${i}`, i, i, `z${i}`)]])
    }
    // 100 hit tests and moves among 20,000 Elements: well under a frame each.
    expect(performance.now() - start).toBeLessThan(500)
  })
})
