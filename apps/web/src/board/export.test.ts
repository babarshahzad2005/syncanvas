import type { ElementWithId } from "@syncanvas/board-model"
import { describe, expect, it } from "vitest"
import { exportElements, exportFileName, pngSize } from "./export"

// Export (M6 ticket 01): what gets exported, its file name, and the PNG size cap.

const rect = (id: string, z: string): ElementWithId => ({
  id,
  type: "rect",
  position: { x: 0, y: 0 },
  size: { w: 10, h: 10 },
  z,
  color: "ink",
  fill: "none",
})

describe("exportElements", () => {
  const all = [rect("a", "a0"), rect("b", "a1"), rect("c", "a2")]
  it("takes the selection in drawing order, or everything", () => {
    expect(exportElements(all, new Set(["c", "a"]), "selection").map((e) => e.id)).toEqual([
      "a",
      "c",
    ])
    expect(exportElements(all, new Set(["c"]), "board")).toHaveLength(3)
  })
})

describe("exportFileName", () => {
  it("names the file after the Board, safely", () => {
    expect(exportFileName("Q3 roadmap", "png")).toBe("Q3 roadmap.png")
    expect(exportFileName('a/b:c*d?"e<f>g|h', "svg")).toBe("a-b-c-d-e-f-g-h.svg")
    expect(exportFileName("tab\there\u0007", "png")).toBe("tabhere.png")
    expect(exportFileName("   ", "pdf")).toBe("Board.pdf")
    expect(exportFileName(undefined, "png")).toBe("Board.png")
  })
})

describe("pngSize", () => {
  it("draws at 2× with 16 units of padding", () => {
    expect(pngSize({ w: 100, h: 50 })).toEqual({ size: { w: 264, h: 164, scale: 2 }, percent: 100 })
  })

  it("scales a huge Board down to 8,192 px and says by how much", () => {
    const { size, percent } = pngSize({ w: 20_000 - 32, h: 1_000 })
    expect(Math.max(size.w, size.h)).toBeLessThanOrEqual(8192)
    expect(percent).toBe(20) // 8,192 / (20,000 × 2) ≈ 0.2
  })
})
