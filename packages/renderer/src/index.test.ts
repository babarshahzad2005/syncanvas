import { describe, expect, it } from "vitest"
import { GRID_SPACING, gridAt } from "./index"

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
