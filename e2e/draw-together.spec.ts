import { expect, test } from "@playwright/test"
import { drag, elements, enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M0 exit check: two browsers edit one Board live, and edits survive a reload.
// Both browsers belong to the same User for now; sharing with a second User arrives in M3.

test("two browsers draw and move rectangles together", async ({ browser }) => {
  const email = `e2e-${Date.now()}@example.com`

  const contextA = await browser.newContext()
  const a = await contextA.newPage()
  await enableTestHooks(a)
  await signIn(a, email)

  await a.getByRole("button", { name: "Blank board" }).click()
  await a.waitForURL(/\/b\//)
  await waitUntilOnline(a)

  const contextB = await browser.newContext({ storageState: await contextA.storageState() })
  const b = await contextB.newPage()
  await enableTestHooks(b)
  await b.goto(a.url())
  await waitUntilOnline(b)

  // A draws a rectangle; B sees it.
  await a.keyboard.press("r")
  await drag(a, { x: 500, y: 300 }, { x: 660, y: 400 })
  await expect.poll(() => elements(b)).toHaveLength(1)
  const [drawn] = await elements(b)
  expect(drawn).toMatchObject({ w: 160, h: 100, color: "ink" })

  // B moves it; A sees the move. Both start with the same camera, so screen spots match.
  await drag(b, { x: 580, y: 350 }, { x: 700, y: 430 })
  await expect.poll(async () => (await elements(a))[0]?.x).toBe((drawn?.x ?? 0) + 120)
  await expect.poll(async () => (await elements(a))[0]?.y).toBe((drawn?.y ?? 0) + 80)

  // Undo only reverts your own changes: B draws a second one, A undoes A's last gesture.
  await b.keyboard.press("r")
  await drag(b, { x: 300, y: 550 }, { x: 380, y: 620 })
  await expect.poll(() => elements(a)).toHaveLength(2)
  await a.keyboard.press("Control+z") // A's last gesture was drawing the first rectangle
  await expect.poll(async () => (await elements(b)).map((e) => e.w)).toEqual([80])

  // Everything survives a reload in both browsers.
  await a.reload()
  await b.reload()
  await waitUntilOnline(a)
  await waitUntilOnline(b)
  await expect.poll(async () => (await elements(a)).map((e) => e.w)).toEqual([80])
  await expect.poll(async () => (await elements(b)).map((e) => e.w)).toEqual([80])

  // Pan and zoom: Ctrl+scroll zooms around the cursor, Shift+1 fits, plain scroll pans.
  const zoomLabel = a.getByRole("button", { name: /^\d+%$/ })
  await expect(zoomLabel).toHaveText("100%")
  const box = await a.getByLabel("Board canvas").boundingBox()
  await a.mouse.move((box?.x ?? 0) + 640, (box?.y ?? 0) + 400)
  await a.keyboard.down("Control")
  await a.mouse.wheel(0, -120)
  await a.keyboard.up("Control")
  await expect(zoomLabel).not.toHaveText("100%")
  await a.keyboard.press("Shift+Digit1")
  await expect(zoomLabel).toHaveText("100%") // small content fits without zooming past 100%
  const before = await a.evaluate(() => window.__syncanvas?.camera().x ?? 0)
  await a.mouse.wheel(150, 0)
  await expect.poll(() => a.evaluate(() => window.__syncanvas?.camera().x ?? 0)).toBe(before - 150)

  await contextA.close()
  await contextB.close()
})
