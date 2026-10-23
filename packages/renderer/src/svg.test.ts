import { type ElementWithId, indexById } from "@syncanvas/board-model"
import { describe, expect, it } from "vitest"
import { escapeXml, toSvg } from "./index"

// SVG export (M6 ticket 02): every Element type, mirroring the canvas.

const base = { z: "a0", position: { x: 10, y: 20 }, size: { w: 100, h: 50 } }
const rect: ElementWithId = { ...base, id: "r", type: "rect", color: "blue", fill: "light" }
const ellipse: ElementWithId = { ...base, id: "e", type: "ellipse", color: "red", fill: "solid" }
const pen: ElementWithId = {
  ...base,
  id: "p",
  type: "pen",
  color: "green",
  width: "M",
  points: [
    [0, 0, 0.5],
    [20, 10, 0.5],
    [40, 0, 0.5],
  ],
}
const arrow: ElementWithId = {
  ...base,
  id: "a",
  type: "arrow",
  color: "ink",
  ends: { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
}
const connector: ElementWithId = {
  id: "c",
  type: "connector",
  z: "a1",
  color: "violet",
  style: "elbow",
  start: { elementId: "r", anchor: "right", fallback: { x: 0, y: 0 } },
  end: { fallback: { x: 300, y: 200 } },
}
const text: ElementWithId = {
  ...base,
  id: "t",
  type: "text",
  color: "ink",
  text: "Tom & <Jerry>",
  fontSize: "M",
  bold: true,
  align: "center",
  autoWidth: false,
  size: { w: 400, h: 30 },
}
const sticky: ElementWithId = {
  ...base,
  id: "s",
  type: "sticky",
  color: "yellow",
  text: "Note",
  fontSize: "M",
  bold: false,
  size: { w: 200, h: 200 },
}
const image: ElementWithId = {
  ...base,
  id: "i",
  type: "image",
  key: "images/b/0b9c1a2e-3f4d-4e5a-9b6c-7d8e9f0a1b2c",
  natural: { w: 200, h: 100 },
}

const all = [rect, ellipse, pen, arrow, connector, text, sticky, image]
const bounds = { x: 0, y: 0, w: 400, h: 300 }
const svgOf = (elements: ElementWithId[], theme: "light" | "dark" = "light", data?: string) =>
  toSvg(elements, indexById(all), bounds, {
    theme,
    imageData: data ? () => data : undefined,
    fontCss: "@font-face{font-family:x}",
  })

describe("toSvg", () => {
  it("frames the bounds with padding, on the canvas background, with the fonts", () => {
    const svg = svgOf([])
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="-16 -16 432 332"/)
    expect(svg).toContain('fill="#F8F7F4"')
    expect(svg).toContain("<style>@font-face{font-family:x}</style>")
    expect(svgOf([], "dark")).toContain('fill="#161514"')
  })

  it("draws shapes with the palette's shades, as the canvas does", () => {
    expect(svgOf([rect])).toContain(
      '<rect x="10" y="20" width="100" height="50" rx="4" fill="#DCE7FD" stroke="#2A64DB" stroke-width="2"/>',
    )
    expect(svgOf([ellipse])).toContain(
      '<ellipse cx="60" cy="45" rx="50" ry="25" fill="#D2382D" stroke="#D2382D" stroke-width="2"/>',
    )
    // Dark theme picks the dark shades.
    expect(svgOf([rect], "dark")).toContain('stroke="#7EA9FF"')
  })

  it("draws pen strokes as filled outlines, and lines with an arrowhead", () => {
    expect(svgOf([pen])).toMatch(/<path d="M[^"]+ Z" fill="#2B8A3E"\/>/)
    const arrowSvg = svgOf([arrow])
    expect(arrowSvg).toContain('<path d="M10 20 L')
    expect(arrowSvg).toMatch(/<path d="M110 20 L[^"]+ Z" fill="#1C1B19"/)
    // An elbow connector from the rectangle's right side: more than one segment.
    expect(svgOf([connector])).toMatch(/<path d="M110 45 L[^"]+ L[^"]+"/)
  })

  it("writes text as real text, escaped, with its weight", () => {
    const svg = svgOf([text])
    expect(svg).toContain("Tom &amp; &lt;Jerry&gt;")
    expect(svg).toContain('font-weight="600"')
    expect(svg).toContain('xml:space="preserve"')
  })

  it("draws a sticky note's colour and clips its text", () => {
    const svg = svgOf([sticky])
    expect(svg).toContain('fill="#FFE58A"')
    expect(svg).toMatch(/<clipPath id="clip1">/)
    expect(svg).toContain('<g clip-path="url(#clip1)">')
    expect(svg).toContain(">Note</text>")
  })

  it("inlines an image's file, or draws its placeholder without one", () => {
    expect(svgOf([image], "light", "data:image/png;base64,AAAA")).toContain(
      '<image href="data:image/png;base64,AAAA" x="10" y="20" width="100" height="50"',
    )
    expect(svgOf([image])).toContain('fill="#F2F0EC"')
  })

  it("escapes everything XML cares about", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f")
  })
})
