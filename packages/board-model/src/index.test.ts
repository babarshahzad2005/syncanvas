import { describe, expect, it } from "vitest"
import { isPaletteColor } from "./index"

describe("isPaletteColor", () => {
  it("accepts palette names and rejects raw colors", () => {
    expect(isPaletteColor("ink")).toBe(true)
    expect(isPaletteColor("#1C1B19")).toBe(false)
    expect(isPaletteColor(undefined)).toBe(false)
  })
})
