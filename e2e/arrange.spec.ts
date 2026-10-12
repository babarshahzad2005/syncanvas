import { expect, test } from "@playwright/test"
import { drag, elements, enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M1 ticket 11: align, distribute, and layering from the tray's ⋯ menu.

test("aligning in one browser moves the Elements in the other", async ({ browser }) => {
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

  // Three rectangles at different heights and uneven spacing.
  for (const [x, y] of [
    [300, 200],
    [380, 260],
    [600, 230],
  ] as const) {
    await a.keyboard.press("r")
    await drag(a, { x, y }, { x: x + 60, y: y + 40 })
  }
  await expect.poll(() => elements(b)).toHaveLength(3)
  const [first] = await elements(b)

  // Select all three and align their tops.
  await drag(a, { x: 250, y: 150 }, { x: 700, y: 350 })
  await a.getByRole("button", { name: "More" }).click()
  await a.getByRole("menuitem", { name: "Align" }).click()
  await a.getByRole("menuitem", { name: "Top" }).click()
  await expect
    .poll(async () => (await elements(b)).map((e) => e.y))
    .toEqual([first?.y, first?.y, first?.y])

  // Distribute horizontally: spanning 360 with 180 of rectangles leaves two 90px gaps.
  await a.getByRole("button", { name: "More" }).click()
  await a.getByRole("menuitem", { name: "Distribute" }).click()
  await a.getByRole("menuitem", { name: "Horizontally" }).click()
  await expect
    .poll(async () => (await elements(b)).map((e) => e.x - (first?.x ?? 0)))
    .toEqual([0, 150, 300])

  // One undo puts the distribute back.
  await a.keyboard.press("Control+z")
  await expect
    .poll(async () => (await elements(b)).map((e) => e.x - (first?.x ?? 0)))
    .toEqual([0, 80, 300])

  // Layering: move the second rectangle over the first, then bring the first forward past it
  // and send it back again.
  await a.keyboard.press("Escape")
  await drag(a, { x: 410, y: 220 }, { x: 350, y: 220 }) // second now overlaps the first
  await expect
    .poll(async () => (await elements(b)).map((e) => e.x - (first?.x ?? 0)))
    .toEqual([0, 20, 300])
  const ids = (await elements(b)).map((e) => e.id)
  await a.mouse.click(
    ((await a.getByLabel("Board canvas").boundingBox())?.x ?? 0) + 305,
    ((await a.getByLabel("Board canvas").boundingBox())?.y ?? 0) + 205,
  )
  await a.keyboard.press("Control+]")
  await expect
    .poll(async () => (await elements(b)).map((e) => e.id))
    .toEqual([ids[1], ids[0], ids[2]])
  await a.keyboard.press("Control+[")
  await expect.poll(async () => (await elements(b)).map((e) => e.id)).toEqual(ids)

  await contextA.close()
  await contextB.close()
})
