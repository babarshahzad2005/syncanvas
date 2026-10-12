import { expect, test } from "@playwright/test"
import { drag, elements, enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M1 ticket 09: resizing from corner handles, scaling a multi-selection, and arrow ends.

test("a resize in one browser shows in the other", async ({ browser }) => {
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
  const sizes = async () => (await elements(b)).map((e) => [e.w, e.h])

  // One rectangle, 100 × 100 and still selected: drag its bottom-right handle.
  await a.keyboard.press("r")
  await drag(a, { x: 300, y: 200 }, { x: 400, y: 300 })
  await drag(a, { x: 400, y: 300 }, { x: 500, y: 350 })
  await expect.poll(sizes).toEqual([[200, 150]])

  // Shift keeps the proportions (the larger of the two scales wins).
  await a.keyboard.down("Shift")
  await drag(a, { x: 500, y: 350 }, { x: 600, y: 360 })
  await a.keyboard.up("Shift")
  await expect.poll(sizes).toEqual([[300, 225]])
  const [single] = await elements(b)

  // A second rectangle; select both and scale the pair by 2 from the bottom-right corner.
  await a.keyboard.press("r")
  await drag(a, { x: 700, y: 200 }, { x: 750, y: 250 })
  await drag(a, { x: 250, y: 150 }, { x: 800, y: 450 })
  // The pair spans (300, 200) to (750, 425): drag its bottom-right corner to twice that.
  await drag(a, { x: 750, y: 425 }, { x: 1200, y: 650 })
  await expect.poll(sizes).toEqual([
    [600, 450],
    [100, 100],
  ])
  const scaled = await elements(b)
  expect((scaled[1]?.x ?? 0) - (scaled[0]?.x ?? 0)).toBe(800)
  expect(scaled[0]?.x).toBe(single?.x)

  // One undo puts both back.
  await a.keyboard.press("Control+z")
  await expect.poll(sizes).toEqual([
    [300, 225],
    [50, 50],
  ])

  // Dragging one end of an arrow moves just that end.
  await a.keyboard.press("Escape")
  await a.keyboard.press("a")
  await drag(a, { x: 300, y: 550 }, { x: 500, y: 550 })
  await drag(a, { x: 500, y: 550 }, { x: 500, y: 650 })
  await expect.poll(async () => (await sizes())[2]).toEqual([200, 100])

  await contextA.close()
  await contextB.close()
})
