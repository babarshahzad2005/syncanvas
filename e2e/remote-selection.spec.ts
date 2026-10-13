import { expect, type Page, test } from "@playwright/test"
import { drag, enableTestHooks, shareBoard, signIn, waitUntilOnline } from "./helpers"

// M2 ticket 04: what others select is outlined in their color, with their name tag.

/** The color of one canvas pixel (page px relative to the canvas), as "#rrggbb". */
async function pixel(page: Page, x: number, y: number) {
  return page.getByLabel("Board canvas").evaluate(
    (canvas, [px = 0, py = 0]) => {
      const c = canvas as HTMLCanvasElement
      const dpr = c.width / c.getBoundingClientRect().width
      const data = c
        .getContext("2d")
        ?.getImageData(Math.round(px * dpr), Math.round(py * dpr), 1, 1).data
      return `#${[...(data ?? [])]
        .slice(0, 3)
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")}`
    },
    [x, y],
  )
}

/** How far apart two "#rrggbb" colors are (sum of channel differences). */
function distance(a: string, b: string) {
  const channels = (c: string) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16))
  const [x, y] = [channels(a), channels(b)]
  return x.reduce((sum, v, i) => sum + Math.abs(v - (y[i] ?? 0)), 0)
}

/** A person's presence color, read from their avatar in the pill. */
async function colorOf(page: Page, name: string) {
  const rgb = await page
    .getByRole("button", { name })
    .locator("span")
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  const [r, g, b] = rgb.match(/\d+/g)?.map(Number) ?? []
  return `#${[r, g, b].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`
}

test("a selection shows in the other window, outlined with a name tag", async ({ browser }) => {
  test.setTimeout(120_000)
  const stamp = Date.now()
  const graceEmail = `e2e-grace-${stamp}@example.com`
  const contextA = await browser.newContext()
  const ada = await contextA.newPage()
  await enableTestHooks(ada)
  await signIn(ada, `e2e-ada-${stamp}@example.com`, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)

  const contextG = await browser.newContext()
  const grace = await contextG.newPage()
  await enableTestHooks(grace)
  await signIn(grace, graceEmail, { name: "Grace Hopper" })
  await shareBoard(ada.url(), graceEmail)
  await grace.goto(ada.url())
  await waitUntilOnline(grace)
  const ada_ = await colorOf(grace, "Ada Lovelace")

  // Ada draws a rectangle, which leaves it selected: Grace sees Ada's tag above its corner.
  await ada.keyboard.press("r")
  await drag(ada, { x: 300, y: 200 }, { x: 420, y: 280 })
  // In the tag's left padding (the name's white letters start 6px in), halfway down.
  const tag = { x: 300 + 3, y: 200 - 4 - 9 }
  await expect.poll(() => pixel(grace, tag.x, tag.y)).toBe(ada_)
  // ...and her outline on the rectangle's edge (over its ink stroke, so it blends a little).
  await expect
    .poll(async () => {
      const edge = await pixel(grace, 360, 200)
      return distance(edge, ada_) < distance(edge, "#1c1b19")
    })
    .toBe(true)

  // Deselecting removes it.
  await ada.keyboard.press("Escape")
  await expect.poll(() => pixel(grace, tag.x, tag.y)).not.toBe(ada_)

  // Selected again, then deleted by Grace: the selection goes with the rectangle.
  const canvas = await ada.getByLabel("Board canvas").boundingBox()
  await ada.mouse.click((canvas?.x ?? 0) + 360, (canvas?.y ?? 0) + 240)
  await expect.poll(() => pixel(grace, tag.x, tag.y)).toBe(ada_)
  const graceCanvas = await grace.getByLabel("Board canvas").boundingBox()
  await grace.mouse.click((graceCanvas?.x ?? 0) + 360, (graceCanvas?.y ?? 0) + 240)
  await grace.keyboard.press("Delete")
  await expect.poll(() => pixel(grace, tag.x, tag.y)).not.toBe(ada_)
  await expect.poll(() => pixel(ada, tag.x, tag.y)).not.toBe(await colorOf(ada, "Grace Hopper"))

  await contextA.close()
  await contextG.close()
})
