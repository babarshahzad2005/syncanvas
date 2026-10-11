import type { StickyElement } from "@syncanvas/board-model"
import { describe, expect, it } from "vitest"
import { STICKY_PADDING, stickyLayoutOf } from "./index"
import { LINE_HEIGHT } from "./text"

// In Node, text is measured as 0.55 × font size per character; only line counts matter here.

const sticky = (text: string): StickyElement => ({
  type: "sticky",
  position: { x: 0, y: 0 },
  size: { w: 200, h: 200 },
  z: "a0",
  color: "yellow",
  text,
  fontSize: "M",
  bold: false,
})
const lines = (count: number) => Array.from({ length: count }, () => "a").join("\n")

describe("stickyLayoutOf", () => {
  it("starts square at the chosen size", () => {
    expect(stickyLayoutOf(sticky(""))).toMatchObject({ fontSize: 16, height: 200, clipped: false })
  })

  it("grows taller with its text", () => {
    const { fontSize, height } = stickyLayoutOf(sticky(lines(15)))
    expect(fontSize).toBe(16)
    expect(height).toBeCloseTo(15 * 16 * LINE_HEIGHT + STICKY_PADDING * 2)
  })

  it("shrinks the text once it reaches twice its width", () => {
    // 25 lines fit in 400 at 11px (25 × 14.3 + 32 = 389.5) but not at 12px.
    expect(stickyLayoutOf(sticky(lines(25)))).toMatchObject({ fontSize: 11, clipped: false })
  })

  it("stops shrinking at 10px and cuts the text off", () => {
    expect(stickyLayoutOf(sticky(lines(40)))).toMatchObject({
      fontSize: 10,
      height: 400,
      clipped: true,
    })
  })

  it("wraps long lines within the padding", () => {
    // 168px inside at 8.8px per character: 19 characters a line.
    const { layout } = stickyLayoutOf(sticky("x".repeat(40)))
    expect(layout.lines.map((l) => l.text.length)).toEqual([19, 19, 2])
  })
})
