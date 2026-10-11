import { describe, expect, it } from "vitest"
import { LINE_HEIGHT, layoutText } from "./text"

// In Node there's no canvas, so text is measured as 0.55 × font size per character
// (11px per character at 20px). The line-breaking rules are what's tested here.

const style = (width: number | null) => ({ fontSize: 20, bold: false, width })
const lines = (content: string, width: number | null) =>
  layoutText(content, style(width)).lines.map((l) => l.text)

describe("layoutText", () => {
  it("breaks auto-width text only at newlines", () => {
    expect(lines("a long first line\nsecond", null)).toEqual(["a long first line", "second"])
    const layout = layoutText("abcd\nab", style(null))
    expect(layout.width).toBe(44)
    expect(layout.height).toBe(2 * 20 * LINE_HEIGHT)
  })

  it("wraps fixed-width text at spaces, keeping the space with the line it ends", () => {
    // 10 characters (110px, plus float rounding) fit in 111px.
    expect(lines("hello there world", 111)).toEqual(["hello ", "there ", "world"])
    expect(lines("hi you all", 111)).toEqual(["hi you all"])
  })

  it("breaks a word longer than a line anywhere", () => {
    expect(lines("abcdefghijklmnopqrstuvwxyz", 111)).toEqual(["abcdefghij", "klmnopqrst", "uvwxyz"])
  })

  it("keeps empty lines and gives empty text one line", () => {
    expect(lines("a\n\nb", 111)).toEqual(["a", "", "b"])
    expect(layoutText("", style(null)).height).toBe(20 * LINE_HEIGHT)
  })
})
