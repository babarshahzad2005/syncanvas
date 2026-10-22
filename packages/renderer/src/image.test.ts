import type { ElementWithId, ImageElement } from "@syncanvas/board-model"
import { describe, expect, it } from "vitest"
import { drawScene, hitTest, type ImageState, type Scene } from "./index"

// Image Elements (M5b ticket 03): drawn from their file, else a placeholder that animates
// while the file is on its way.

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

const picture: ElementWithId = {
  id: "i",
  type: "image",
  key: "images/b/0b9c1a2e-3f4d-4e5a-9b6c-7d8e9f0a1b2c",
  natural: { w: 800, h: 400 },
  position: { x: 10, y: 20 },
  size: { w: 200, h: 100 },
  z: "a0",
}

function draw(images: Scene["images"], extra: Partial<Scene> = {}) {
  const { ctx, calls } = recorder()
  const busy = drawScene(ctx, {
    elements: [picture],
    camera: { x: 0, y: 0, zoom: 1 },
    theme: "light",
    size: { w: 400, h: 300 },
    dpr: 1,
    selection: new Set(),
    showGrid: false,
    images,
    ...extra,
  })
  return { busy, calls }
}

describe("image Elements", () => {
  it("draw their file into their box once it's ready", () => {
    const bitmap = {} as CanvasImageSource
    const asked: ImageElement[] = []
    const { busy, calls } = draw((e) => {
      asked.push(e)
      return { bitmap }
    })
    expect(asked.map((e) => e.key)).toEqual([picture.type === "image" && picture.key])
    expect(calls.find((c) => c.name === "drawImage")?.args).toEqual([bitmap, 10, 20, 200, 100])
    expect(busy).toBe(false)
  })

  it("show a spinning placeholder while loading, and a still one once given up", () => {
    const loading = draw(() => "loading" as ImageState)
    expect(loading.calls.some((c) => c.name === "arc")).toBe(true)
    expect(loading.busy).toBe(true)
    const missing = draw(() => "missing" as ImageState)
    expect(missing.calls.some((c) => c.name === "arc")).toBe(false)
    expect(missing.calls.find((c) => c.name === "fillRect" && c.args[0] === 10)).toBeTruthy()
    expect(missing.busy).toBe(false)
  })

  it("draws this tab's uploads as placeholders, spinning until one fails", () => {
    const upload = { position: { x: 0, y: 0 }, size: { w: 50, h: 50 } }
    expect(draw(undefined, { elements: [], uploads: [{ ...upload, failed: false }] }).busy).toBe(
      true,
    )
    expect(draw(undefined, { elements: [], uploads: [{ ...upload, failed: true }] }).busy).toBe(
      false,
    )
  })

  it("are hit anywhere in their box", () => {
    expect(hitTest([picture], { x: 100, y: 60 }, 1)).toBe("i")
    expect(hitTest([picture], { x: 300, y: 60 }, 1)).toBe(null)
  })
})

describe("pictures", () => {
  it("draw in the theme asked for, light by default", async () => {
    const { drawImage } = await import("./index")
    const fills = (theme?: "light" | "dark") => {
      const set: string[] = []
      const ctx = new Proxy({} as Record<string, unknown>, {
        get: () => () => {},
        set: (_t, name, value) => {
          if (name === "fillStyle") set.push(String(value))
          return true
        },
      }) as unknown as CanvasRenderingContext2D
      drawImage(
        ctx,
        [],
        new Map(),
        { x: 0, y: 0, w: 10, h: 10 },
        { w: 42, h: 42, scale: 1 },
        16,
        undefined,
        theme,
      )
      return set[0]
    }
    expect(fills()).toBe("#F8F7F4")
    expect(fills("dark")).toBe("#161514")
  })
})
