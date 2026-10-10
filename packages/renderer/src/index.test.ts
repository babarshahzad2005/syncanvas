import type { ElementWithId } from "@syncanvas/board-model"
import { describe, expect, it } from "vitest"
import {
  fitCamera,
  GRID_SPACING,
  gridAt,
  hitTest,
  MAX_ZOOM,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from "./index"

describe("gridAt", () => {
  it("keeps the base spacing at normal zoom", () => {
    expect(gridAt(1)).toEqual({ spacing: GRID_SPACING, opacity: 1 })
  })
  it("doubles spacing and fades below 50%", () => {
    expect(gridAt(0.375)).toEqual({ spacing: GRID_SPACING * 2, opacity: 0.5 })
  })
  it("hides the grid at 25% and below", () => {
    expect(gridAt(0.2).opacity).toBe(0)
  })
})

describe("camera", () => {
  const camera = { x: 100, y: 50, zoom: 2 }

  it("round-trips between world and screen", () => {
    const world = { x: 7, y: -3 }
    expect(screenToWorld(camera, worldToScreen(camera, world))).toEqual(world)
  })

  it("zooms around the cursor, keeping the point under it still", () => {
    const anchor = { x: 400, y: 300 }
    const before = screenToWorld(camera, anchor)
    const after = screenToWorld(zoomAt(camera, anchor, 1.5), anchor)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it("clamps zoom", () => {
    expect(zoomAt(camera, { x: 0, y: 0 }, 1000).zoom).toBe(MAX_ZOOM)
  })

  it("fits content in the viewport without zooming past 100%", () => {
    const fit = fitCamera({ x: 0, y: 0, w: 100, h: 100 }, { w: 800, h: 600 })
    expect(fit.zoom).toBe(1)
    expect(worldToScreen(fit, { x: 50, y: 50 })).toEqual({ x: 400, y: 300 })
  })
})

describe("hitTest", () => {
  const rect = (id: string, x: number, z: string): ElementWithId => ({
    id,
    type: "rect",
    position: { x, y: 0 },
    size: { w: 100, h: 100 },
    z,
    color: "ink",
  })

  it("returns the topmost Element under the point", () => {
    const elements = [rect("bottom", 0, "a0"), rect("top", 50, "a1")]
    expect(hitTest(elements, { x: 75, y: 50 }, 1)).toBe("top")
    expect(hitTest(elements, { x: 25, y: 50 }, 1)).toBe("bottom")
    expect(hitTest(elements, { x: 500, y: 50 }, 1)).toBeNull()
  })
})
