import { expect, type Page, test } from "@playwright/test"
import { drag, enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M1 ticket 13: copy a group with a connector from one Board and paste it into another.

async function all(page: Page) {
  return page.evaluate(() => window.__syncanvas?.elements() ?? [])
}

async function newBoard(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "Blank board" }).click()
  await page.waitForURL(/\/b\//)
  await waitUntilOnline(page)
}

test("a group with its connector pastes into another Board", async ({ browser }) => {
  const contextA = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })
  const x = await contextA.newPage()
  await enableTestHooks(x)
  await signIn(x, `e2e-${Date.now()}@example.com`)
  await newBoard(x)

  // Board X: two grouped rectangles joined by a connector.
  await x.keyboard.press("r")
  await drag(x, { x: 300, y: 200 }, { x: 400, y: 280 })
  await x.keyboard.press("r")
  await drag(x, { x: 550, y: 200 }, { x: 650, y: 280 })
  await x.keyboard.press("c")
  await drag(x, { x: 395, y: 240 }, { x: 555, y: 240 })
  await drag(x, { x: 250, y: 150 }, { x: 700, y: 330 })
  await x.keyboard.press("Control+g")
  await expect.poll(async () => (await all(x)).filter((e) => e.groupId).length).toBe(3)
  await x.keyboard.press("Control+c")

  // Board Y, open in A and in B.
  const y = await contextA.newPage()
  await enableTestHooks(y)
  await newBoard(y)
  const contextB = await browser.newContext({ storageState: await contextA.storageState() })
  const b = await contextB.newPage()
  await enableTestHooks(b)
  await b.goto(y.url())
  await waitUntilOnline(b)

  // Paste at the cursor.
  const canvas = await y.getByLabel("Board canvas").boundingBox()
  await y.mouse.move((canvas?.x ?? 0) + 640, (canvas?.y ?? 0) + 400)
  await y.keyboard.press("Control+v")
  await expect.poll(async () => (await all(b)).length).toBe(3)
  const pasted = await all(b)
  const source = await all(x)
  // New ids, one shared new group, and the connector attached to the pasted rectangles.
  expect(pasted.some((e) => source.some((s) => s.id === e.id))).toBe(false)
  expect(new Set(pasted.map((e) => e.groupId)).size).toBe(1)
  const connector = pasted.find((e) => e.type === "connector")
  const rects = pasted.filter((e) => e.type === "rect").map((e) => e.id)
  expect([connector?.start?.elementId, connector?.end?.elementId].sort()).toEqual(rects.sort())
  // Centered on the cursor (the canvas starts with the world origin in its middle).
  const box = await y.evaluate(() => window.__syncanvas?.camera())
  const xs = pasted.flatMap((e) =>
    e.position && e.size ? [e.position.x, e.position.x + e.size.w] : [],
  )
  const center = (Math.min(...xs) + Math.max(...xs)) / 2
  expect(Math.round(center * (box?.zoom ?? 1) + (box?.x ?? 0))).toBe(640)

  // Duplicate the pasted selection: three more, 16 units over.
  await y.keyboard.press("Control+d")
  await expect.poll(async () => (await all(b)).length).toBe(6)

  // Cut removes the selection; paste brings it back.
  await y.keyboard.press("Control+x")
  await expect.poll(async () => (await all(b)).length).toBe(3)
  await y.keyboard.press("Control+v")
  await expect.poll(async () => (await all(b)).length).toBe(6)

  await contextA.close()
  await contextB.close()
})
