import { expect, type Page, test } from "@playwright/test"
import pixelmatch from "pixelmatch"
import { PNG } from "pngjs"
import { enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// S8 export fidelity (PRD §2; M6 ticket 04): a fixed corpus Board, exported to PNG and SVG,
// compared pixel by pixel. The PNG export is drawn by the screen's own renderer (drawScene,
// without grid or selection), so it stands for the screen; the SVG is a separate backend and
// must match it. PDF is made from the same SVG (svg2pdf), so this covers its drawing too.

/**
 * Most pixels allowed to differ, as a share of the picture (anti-aliased edges excepted).
 * Measured: 1–2 of about 3.1 million. One shape's stroke in the wrong color is about 0.17%,
 * so 0.02% (about 600 pixels) catches a real slip with room for font hinting.
 */
const MAX_DIFF = { light: 0.0002, dark: 0.0002 }

const COLORS = [
  "ink",
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const
const FILLS = ["none", "light", "solid"] as const
const STICKIES = ["yellow", "orange", "pink", "violet", "blue", "green"] as const

/** The corpus: every Element type and style, laid out in rows (paste keeps their layout). */
function corpus() {
  const z = "a0" // pasting gives each its own order key, in this order
  const out: Record<string, unknown>[] = []
  COLORS.forEach((color, i) => {
    out.push({
      id: `rect-${i}`,
      type: "rect",
      z,
      color,
      fill: FILLS[i % 3],
      position: { x: i * 80, y: 0 },
      size: { w: 64, h: 44 },
    })
  })
  COLORS.slice(0, 5).forEach((color, i) => {
    out.push({
      id: `ellipse-${i}`,
      type: "ellipse",
      z,
      color,
      fill: FILLS[(i + 1) % 3],
      position: { x: i * 80, y: 70 },
      size: { w: 64, h: 44 },
    })
  })
  ;(["S", "M", "L"] as const).forEach((width, i) => {
    out.push({
      id: `pen-${i}`,
      type: "pen",
      z,
      color: COLORS[i + 5],
      width,
      position: { x: 420 + i * 90, y: 70 },
      size: { w: 70, h: 40 },
      points: [
        [0, 30, 0.5],
        [15, 5, 0.5],
        [35, 35, 0.5],
        [55, 8, 0.5],
        [70, 25, 0.5],
      ],
    })
  })
  out.push({
    id: "arrow-1",
    type: "arrow",
    z,
    color: "ink",
    position: { x: 0, y: 140 },
    size: { w: 150, h: 40 },
    ends: { from: { x: 0, y: 40 }, to: { x: 150, y: 0 } },
  })
  out.push({
    id: "arrow-2",
    type: "arrow",
    z,
    color: "red",
    position: { x: 170, y: 140 },
    size: { w: 100, h: 0 },
    ends: { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
  })
  // Connectors: straight and elbow between two boxes, and one with a free end.
  out.push(
    {
      id: "box-a",
      type: "rect",
      z,
      color: "blue",
      fill: "light",
      position: { x: 320, y: 140 },
      size: { w: 60, h: 40 },
    },
    {
      id: "box-b",
      type: "rect",
      z,
      color: "green",
      fill: "light",
      position: { x: 480, y: 200 },
      size: { w: 60, h: 40 },
    },
    {
      id: "conn-straight",
      type: "connector",
      z,
      color: "ink",
      style: "straight",
      start: { elementId: "box-a", anchor: "right", fallback: { x: 380, y: 160 } },
      end: { elementId: "box-b", anchor: "left", fallback: { x: 480, y: 220 } },
    },
    {
      id: "conn-elbow",
      type: "connector",
      z,
      color: "violet",
      style: "elbow",
      start: { elementId: "box-a", anchor: "bottom", fallback: { x: 350, y: 180 } },
      end: { elementId: "box-b", anchor: "top", fallback: { x: 510, y: 200 } },
    },
    {
      id: "conn-free",
      type: "connector",
      z,
      color: "teal",
      style: "elbow",
      start: { elementId: "box-b", anchor: "right", fallback: { x: 540, y: 220 } },
      end: { fallback: { x: 640, y: 150 } },
    },
  )
  // A group: two members with the same groupId.
  out.push(
    {
      id: "g-1",
      type: "rect",
      z,
      color: "orange",
      fill: "solid",
      groupId: "g",
      position: { x: 680, y: 140 },
      size: { w: 40, h: 40 },
    },
    {
      id: "g-2",
      type: "ellipse",
      z,
      color: "pink",
      fill: "light",
      groupId: "g",
      position: { x: 730, y: 140 },
      size: { w: 40, h: 40 },
    },
  )
  // Text: every size, the three alignments, bold, auto and fixed width.
  ;(["S", "M", "L", "XL"] as const).forEach((fontSize, i) => {
    out.push({
      id: `text-${i}`,
      type: "text",
      z,
      color: COLORS[i * 2],
      text: `Text ${fontSize}: quick brown fox`,
      fontSize,
      bold: i % 2 === 1,
      align: (["left", "center", "right", "left"] as const)[i],
      autoWidth: i === 3,
      position: { x: 0, y: 260 + i * 60 },
      size: { w: 380, h: 30 },
    })
  })
  out.push({
    id: "text-wrap",
    type: "text",
    z,
    color: "ink",
    text: "A fixed-width paragraph that wraps across several lines of text.",
    fontSize: "M",
    bold: false,
    align: "left",
    autoWidth: false,
    position: { x: 420, y: 260 },
    size: { w: 220, h: 80 },
  })
  // Sticky notes: every color, the three sizes, bold, and one long enough to shrink.
  STICKIES.forEach((color, i) => {
    out.push({
      id: `sticky-${i}`,
      type: "sticky",
      z,
      color,
      text: i === 5 ? "A long note. ".repeat(30) : `Sticky ${color}`,
      fontSize: (["S", "M", "L"] as const)[i % 3],
      bold: i === 1,
      position: { x: i * 130, y: 520 },
      size: { w: 120, h: 120 },
    })
  })
  return { syncanvas: 1, elements: out }
}

/** Pastes the corpus through the real clipboard path (HTML with the Elements in it). */
async function pasteCorpus(page: Page) {
  await page.evaluate((payload) => {
    const json = JSON.stringify(payload)
    const encoded = btoa(String.fromCodePoint(...new TextEncoder().encode(json)))
    const data = new DataTransfer()
    data.setData("text/html", `<img src="x" alt="Syncanvas" data-syncanvas="${encoded}">`)
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data }))
  }, corpus())
}

/** Drops a gradient PNG on the canvas at (x, y) in canvas px. */
async function dropImage(page: Page, x: number, y: number) {
  const box = await page.getByLabel("Board canvas").boundingBox()
  const dataTransfer = await page.evaluateHandle(async () => {
    const c = new OffscreenCanvas(200, 100)
    const g = c.getContext("2d")
    if (g) {
      const grad = g.createLinearGradient(0, 0, 200, 100)
      grad.addColorStop(0, "#4f46e5")
      grad.addColorStop(1, "#f59e0b")
      g.fillStyle = grad
      g.fillRect(0, 0, 200, 100)
    }
    const dt = new DataTransfer()
    const blob = await c.convertToBlob({ type: "image/png" })
    dt.items.add(new File([blob], "gradient.png", { type: "image/png" }))
    return dt
  })
  const at = { clientX: (box?.x ?? 0) + x, clientY: (box?.y ?? 0) + y }
  await page.getByLabel("Board canvas").dispatchEvent("dragover", { dataTransfer, ...at })
  await page.getByLabel("Board canvas").dispatchEvent("drop", { dataTransfer, ...at })
}

/** The SVG drawn by the browser into a canvas of `w` × `h` pixels, as PNG bytes. */
async function rasterizeSvg(page: Page, svgUrl: string, w: number, h: number) {
  const pngUrl = await page.evaluate(
    async ({ url, w, h }) => {
      const img = new Image()
      img.src = url
      await img.decode()
      const canvas = document.createElement("canvas")
      canvas.width = w
      canvas.height = h
      canvas.getContext("2d")?.drawImage(img, 0, 0, w, h)
      return canvas.toDataURL("image/png")
    },
    { url: svgUrl, w, h },
  )
  return Buffer.from(pngUrl.split(",")[1] ?? "", "base64")
}

test("PNG and SVG exports match across the corpus Board, light and dark", async ({
  browser,
}, info) => {
  test.setTimeout(180_000)
  const page = await (await browser.newContext()).newPage()
  await enableTestHooks(page)
  await signIn(page, `e2e-s8-${Date.now()}@example.com`)
  await page.getByRole("button", { name: "Blank board" }).click()
  await page.waitForURL(/\/b\//)
  await waitUntilOnline(page)
  await page.mouse.move(640, 300)
  await pasteCorpus(page)
  const pasted = corpus().elements.length
  await expect.poll(() => page.evaluate(() => window.__syncanvas?.elements().length)).toBe(pasted)
  await dropImage(page, 1100, 150)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const image = window.__syncanvas?.elements().find((e) => e.type === "image")
        return image?.key ? window.__syncanvas?.image(image.key) : null
      }),
    )
    .toBe("ready")

  for (const theme of ["light", "dark"] as const) {
    const pngUrl = await page.evaluate((t) => window.__syncanvas?.exportFile("png", t), theme)
    const svgUrl = await page.evaluate((t) => window.__syncanvas?.exportFile("svg", t), theme)
    const png = PNG.sync.read(Buffer.from((pngUrl ?? "").split(",")[1] ?? "", "base64"))
    const svg = PNG.sync.read(await rasterizeSvg(page, svgUrl ?? "", png.width, png.height))
    const diff = new PNG({ width: png.width, height: png.height })
    const differing = pixelmatch(png.data, svg.data, diff.data, png.width, png.height, {
      threshold: 0.1,
      includeAA: false,
    })
    const share = differing / (png.width * png.height)
    console.log(
      `${theme}: ${differing} of ${png.width * png.height} pixels differ (${(share * 100).toFixed(3)}%)`,
    )
    if (share > MAX_DIFF[theme]) {
      await info.attach(`${theme}-png`, { body: PNG.sync.write(png), contentType: "image/png" })
      await info.attach(`${theme}-svg`, { body: PNG.sync.write(svg), contentType: "image/png" })
      await info.attach(`${theme}-diff`, { body: PNG.sync.write(diff), contentType: "image/png" })
    }
    expect(share).toBeLessThanOrEqual(MAX_DIFF[theme])
  }
})
