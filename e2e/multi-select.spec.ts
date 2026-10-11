import { expect, test } from "@playwright/test"
import { drag, elements, enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M1 ticket 08: marquee and Shift+click selection, moved, nudged, and deleted together.

test("a marquee selection moves together in the other browser", async ({ browser }) => {
  const contextA = await browser.newContext()
  const a = await contextA.newPage()
  await enableTestHooks(a)
  await signIn(a, `e2e-${Date.now()}@example.com`)
  await a.getByRole("button", { name: "Blank board" }).click()
  await a.waitForURL(/\/b\//)
  await waitUntilOnline(a)

  const contextB = await browser.newContext({ storageState: await contextA.storageState() })
  const b = await contextB.newPage()
  await enableTestHooks(b)
  await b.goto(a.url())
  await waitUntilOnline(b)

  // Three rectangles in a row, and a fourth further down that the marquee leaves out.
  for (const x of [300, 450, 600]) {
    await a.keyboard.press("r")
    await drag(a, { x, y: 200 }, { x: x + 100, y: 280 })
  }
  await a.keyboard.press("r")
  await drag(a, { x: 300, y: 500 }, { x: 400, y: 580 })
  await expect.poll(() => elements(b)).toHaveLength(4)
  const before = await elements(b)
  const xs = (list: typeof before) => list.map((e) => [e.x, e.y])

  // Marquee from empty canvas around the first three, then drag one of them.
  await drag(a, { x: 250, y: 150 }, { x: 750, y: 320 })
  await drag(a, { x: 350, y: 240 }, { x: 410, y: 280 })
  await expect
    .poll(async () => xs(await elements(b)))
    .toEqual(before.map((e, i) => (i < 3 ? [e.x + 60, e.y + 40] : [e.x, e.y])))

  // One undo puts all three back.
  await a.keyboard.press("Control+z")
  await expect.poll(async () => xs(await elements(b))).toEqual(xs(before))

  // Shift+click adds the fourth; Shift+arrow nudges all four by 10, an arrow by 1.
  await a.keyboard.down("Shift")
  const canvas = await a.getByLabel("Board canvas").boundingBox()
  await a.mouse.click((canvas?.x ?? 0) + 350, (canvas?.y ?? 0) + 540)
  await a.keyboard.press("ArrowRight")
  await a.keyboard.up("Shift")
  await a.keyboard.press("ArrowDown")
  await expect
    .poll(async () => xs(await elements(b)))
    .toEqual(before.map((e) => [e.x + 10, e.y + 1]))
  // Each press is its own undo step.
  await a.keyboard.press("Control+z")
  await expect.poll(async () => xs(await elements(b))).toEqual(before.map((e) => [e.x + 10, e.y]))

  // Delete removes everything selected (one undo brings it all back).
  await a.keyboard.press("Delete")
  await expect.poll(() => elements(b)).toHaveLength(0)
  await a.keyboard.press("Control+z")
  await expect.poll(() => elements(b)).toHaveLength(4)

  // Escape clears the selection, and the style tray goes with it.
  await drag(a, { x: 250, y: 150 }, { x: 750, y: 320 })
  await expect(a.getByRole("toolbar", { name: "Style" })).toBeVisible()
  await a.keyboard.press("Escape")
  await expect(a.getByRole("toolbar", { name: "Style" })).toBeHidden()

  await contextA.close()
  await contextB.close()
})
