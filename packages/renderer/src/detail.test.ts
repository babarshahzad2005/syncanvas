import type { ElementWithId } from "@syncanvas/board-model"
import { describe, expect, it } from "vitest"
import { drawScene, type Scene, sketchPen, squareCorners, textAsBars } from "./index"

// Zoomed-out drawing (M6 ticket 08c): text too small to read is drawn as bars on screen, and
// pictures keep full detail.

/** A 2D context that records the calls it gets and ignores everything else. */
function recorder() {
  const calls: { name: string; args: unknown[] }[] = []
  const ctx = new Proxy(
    {},
    {
      get:
        (_t, name) =>
        (...args: unknown[]) =>
          void calls.push({ name: String(name), args }),
      set: () => true,
    },
  ) as CanvasRenderingContext2D
  return { ctx, calls }
}

const note: ElementWithId = {
  id: "s",
  type: "sticky",
  position: { x: 0, y: 0 },
  size: { w: 200, h: 200 },
  z: "a0",
  color: "yellow",
  text: "one\ntwo\nthree",
  fontSize: "M",
  bold: false,
}

const label: ElementWithId = {
  id: "t",
  type: "text",
  position: { x: 0, y: 300 },
  size: { w: 100, h: 26 },
  z: "a1",
  color: "ink",
  text: "Label",
  fontSize: "M",
  bold: false,
  align: "left",
  autoWidth: true,
}

function draw(zoom: number, extra: Partial<Scene> = {}) {
  const { ctx, calls } = recorder()
  drawScene(ctx, {
    elements: [note, label],
    camera: { x: 0, y: 0, zoom },
    theme: "light",
    size: { w: 400, h: 300 },
    dpr: 1,
    selection: new Set(),
    showGrid: false,
    ...extra,
  })
  return { texts: calls.filter((c) => c.name === "fillText").length, calls }
}

describe("textAsBars", () => {
  it("is for text under 4px on screen, and only when simplifying", () => {
    expect(textAsBars(16, 0.2)).toBe(true) // 3.2px
    expect(textAsBars(16, 0.25)).toBe(false) // 4px
    expect(textAsBars(72, 0.05)).toBe(true)
    expect(textAsBars(16, null)).toBe(false)
  })

  it("decides per size, so big text stays readable at the same zoom", () => {
    expect(textAsBars(14, 0.2)).toBe(true)
    expect(textAsBars(48, 0.2)).toBe(false)
  })
})

describe("squareCorners", () => {
  it("squares corners under 1px on screen, only when simplifying", () => {
    expect(squareCorners(4, 0.2)).toBe(true)
    expect(squareCorners(4, 0.25)).toBe(false)
    expect(squareCorners(4, null)).toBe(false)
  })
})

describe("sketchPen", () => {
  const pen: ElementWithId & { type: "pen" } = {
    id: "p",
    type: "pen",
    position: { x: 0, y: 0 },
    size: { w: 200, h: 100 },
    z: "a0",
    color: "ink",
    width: "M",
    points: [
      [0, 0, 0.5],
      [100, 50, 0.5],
      [200, 100, 0.5],
    ],
  }

  it("sketches strokes under 48px on screen, only when simplifying", () => {
    expect(sketchPen(pen, 0.2)).toBe(true) // 40px
    expect(sketchPen(pen, 0.25)).toBe(false) // 50px
    expect(sketchPen(pen, null)).toBe(false)
  })

  it("draws a sketched stroke as one line, and a full one as its outline", () => {
    const run = (zoom: number) => {
      const { ctx, calls } = recorder()
      drawScene(ctx, {
        elements: [pen],
        camera: { x: 0, y: 0, zoom },
        theme: "light",
        size: { w: 400, h: 300 },
        dpr: 1,
        selection: new Set(),
        showGrid: false,
        simplify: true,
      })
      return calls.map((c) => c.name)
    }
    expect(run(0.1)).toContain("stroke")
    expect(run(0.1)).not.toContain("fill")
    expect(run(1)).toContain("fill")
  })
})

describe("drawScene detail", () => {
  it("draws letters when they're big enough", () => {
    expect(draw(1, { simplify: true }).texts).toBe(4) // three sticky lines and the label
    expect(draw(0.3, { simplify: true }).texts).toBe(4)
  })

  it("draws small text as one bar per line instead, without clipping", () => {
    const { texts, calls } = draw(0.1, { simplify: true })
    expect(texts).toBe(0)
    expect(calls.filter((c) => c.name === "clip")).toHaveLength(0)
    // Sticky background, then 3 + 1 bars.
    expect(calls.filter((c) => c.name === "fillRect")).toHaveLength(1 + 4)
  })

  it("draws tiny corners square, and keeps them round when they show", () => {
    const tiny = draw(0.1, { simplify: true }).calls
    expect(tiny.filter((c) => c.name === "roundRect")).toHaveLength(0)
    expect(tiny.filter((c) => c.name === "rect")).toHaveLength(1)
    const near = draw(1, { simplify: true }).calls
    expect(near.filter((c) => c.name === "roundRect")).toHaveLength(1)
  })

  it("keeps full detail for pictures (no simplify)", () => {
    expect(draw(0.1).calls.filter((c) => c.name === "roundRect")).toHaveLength(1)
    expect(draw(0.1).texts).toBe(4)
    expect(draw(0.1, { lineZoom: 1 }).texts).toBe(4)
  })
})
