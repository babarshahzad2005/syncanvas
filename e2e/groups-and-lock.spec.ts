import { expect, type Page, test } from "@playwright/test"
import { drag, elements, enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M1 ticket 10: groups select and move as one; locked Elements can't be selected by accident.

async function flags(page: Page) {
  return page.evaluate(
    () => window.__syncanvas?.elements().map((e) => [e.groupId ?? null, e.locked ?? false]) ?? [],
  )
}

test("a group moves as one, and a locked Element can't be selected", async ({ browser }) => {
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
  const spots = async (page: Page) => (await elements(page)).map((e) => [e.x, e.y])

  // A draws two rectangles and groups them.
  await a.keyboard.press("r")
  await drag(a, { x: 300, y: 200 }, { x: 400, y: 280 })
  await a.keyboard.press("r")
  await drag(a, { x: 450, y: 200 }, { x: 550, y: 280 })
  await drag(a, { x: 250, y: 150 }, { x: 600, y: 320 })
  await a.keyboard.press("Control+g")
  await expect
    .poll(async () => {
      const [first, second] = await flags(b)
      return first?.[0] !== null && first?.[0] === second?.[0]
    })
    .toBe(true)
  const start = await spots(a)

  // B drags one member: the whole group moves, and A sees it.
  await drag(b, { x: 350, y: 240 }, { x: 350, y: 340 })
  await expect.poll(() => spots(a)).toEqual(start.map(([x, y]) => [x, (y ?? 0) + 100]))

  // A double-click picks out one member; dragging it moves just that one.
  await b.mouse.dblclick(
    ((await b.getByLabel("Board canvas").boundingBox())?.x ?? 0) + 500,
    ((await b.getByLabel("Board canvas").boundingBox())?.y ?? 0) + 340,
  )
  await drag(b, { x: 500, y: 340 }, { x: 600, y: 340 })
  await expect
    .poll(() => spots(a))
    .toEqual([
      [start[0]?.[0], (start[0]?.[1] ?? 0) + 100],
      [(start[1]?.[0] ?? 0) + 100, (start[1]?.[1] ?? 0) + 100],
    ])

  // Ungroup from the ⋯ menu.
  await a.keyboard.press("Escape")
  const canvas = await a.getByLabel("Board canvas").boundingBox()
  const at = (x: number, y: number) => ({ x: (canvas?.x ?? 0) + x, y: (canvas?.y ?? 0) + y })
  await a.mouse.click(at(350, 340).x, at(350, 340).y)
  await a.getByRole("button", { name: "More" }).click()
  await a.getByRole("menuitem", { name: /Ungroup/ }).click()
  await expect
    .poll(() => flags(b))
    .toEqual([
      [null, false],
      [null, false],
    ])

  // Lock the first rectangle; then clicks and marquees pass it by.
  await a.keyboard.press("Escape")
  await a.mouse.click(at(350, 340).x, at(350, 340).y)
  await a.keyboard.press("Control+Shift+l")
  await expect.poll(async () => (await flags(b))[0]).toEqual([null, true])
  await a.keyboard.press("Escape")
  const tray = a.getByRole("toolbar", { name: "Style" })
  await a.mouse.click(at(350, 340).x, at(350, 340).y)
  await expect(tray).toBeHidden()
  await drag(a, { x: 250, y: 250 }, { x: 420, y: 400 })
  await expect(tray).toBeHidden()
  // Dragging it moves nothing.
  await drag(a, { x: 350, y: 340 }, { x: 350, y: 500 })
  expect((await spots(b))[0]).toEqual([start[0]?.[0], (start[0]?.[1] ?? 0) + 100])

  // Hovering shows its lock badge (on the top-right corner); clicking the badge selects it,
  // and the tray offers only Unlock.
  await a.mouse.move(at(350, 340).x, at(350, 340).y)
  await a.mouse.click(at(400, 300).x, at(400, 300).y)
  await expect(tray).toBeVisible()
  await expect(a.getByRole("button", { name: "Unlock" })).toHaveAttribute("aria-pressed", "true")
  await expect(a.getByRole("button", { name: "Color red" })).toHaveCount(0)
  await a.getByRole("button", { name: "Unlock" }).click()
  await expect.poll(async () => (await flags(b))[0]).toEqual([null, false])

  await contextA.close()
  await contextB.close()
})
