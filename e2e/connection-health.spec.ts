import { expect, type Page, test } from "@playwright/test"
import { drag, elements, enableTestHooks, shareBoard, signIn, waitUntilOnline } from "./helpers"

// M2 ticket 06: a silently dead connection is noticed and replaced; and the M2 exit check, a
// long offline session in which both sides edit, merges completely.

async function all(page: Page) {
  const list = await page.evaluate(() => window.__syncanvas?.elements() ?? [])
  return list.sort((a, b) => (a.id < b.id ? -1 : 1))
}

async function at(page: Page, x: number, y: number) {
  const box = await page.getByLabel("Board canvas").boundingBox()
  return { x: (box?.x ?? 0) + x, y: (box?.y ?? 0) + y }
}

async function twoPeople(
  browser: import("@playwright/test").Browser,
  graceSetup?: (g: Page) => Promise<void>,
) {
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
  await graceSetup?.(grace)
  await signIn(grace, graceEmail, { name: "Grace Hopper" })
  await shareBoard(ada.url(), graceEmail)
  await grace.goto(ada.url())
  await waitUntilOnline(grace)
  return { ada, grace, contextA, contextG }
}

test("a connection that dies silently is noticed and replaced", async ({ browser }) => {
  test.setTimeout(120_000)
  // Grace's socket goes through a relay we can cut without any offline event: exactly what a
  // laptop waking from sleep sees. Her heartbeat runs fast for the test.
  let connections = 0
  let cut = false
  const { ada, grace, contextA, contextG } = await twoPeople(browser, async (g) => {
    await g.addInitScript(() => {
      window.__SYNCANVAS_HEARTBEAT__ = { pingEvery: 500, deadAfter: 2_000 }
    })
    await g.routeWebSocket(/\/ws\//, (ws) => {
      const id = ++connections
      const server = ws.connectToServer()
      ws.onMessage((m) => {
        if (!(cut && id === 1)) server.send(m)
      })
      server.onMessage((m) => {
        if (!(cut && id === 1)) ws.send(m)
      })
    })
  })
  expect(connections).toBe(1)

  // The relay goes silent. Ada keeps drawing; Grace's heartbeat notices, she reconnects, and
  // Ada's rectangle arrives.
  cut = true
  await ada.keyboard.press("r")
  await drag(ada, { x: 300, y: 200 }, { x: 400, y: 280 })
  await expect.poll(() => connections, { timeout: 15_000 }).toBe(2)
  await expect.poll(async () => (await elements(grace)).length, { timeout: 15_000 }).toBe(1)

  await contextA.close()
  await contextG.close()
})

test("both sides edit through a long offline session, and everything merges", async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const { ada, grace, contextA, contextG } = await twoPeople(browser)

  // Ada sets up: a text, two rectangles joined by a connector, and a sticky note.
  await ada.keyboard.press("t")
  let p = await at(ada, 300, 150)
  await ada.mouse.click(p.x, p.y)
  await ada.keyboard.type("hello")
  await ada.keyboard.press("Escape")
  await ada.keyboard.press("Escape")
  await ada.keyboard.press("r")
  await drag(ada, { x: 300, y: 250 }, { x: 400, y: 320 })
  await ada.keyboard.press("r")
  await drag(ada, { x: 550, y: 250 }, { x: 650, y: 320 })
  await ada.keyboard.press("c")
  await drag(ada, { x: 395, y: 285 }, { x: 555, y: 285 })
  await ada.keyboard.press("s")
  p = await at(ada, 800, 450)
  await ada.mouse.click(p.x, p.y)
  await ada.keyboard.type("old note")
  await ada.keyboard.press("Escape")
  await ada.keyboard.press("Escape")
  await expect.poll(async () => (await all(grace)).length).toBe(5)
  const [rectA] = (await elements(ada)).filter((e) => e.type === "rect")

  // Grace goes offline and keeps working.
  await contextG.setOffline(true)
  await expect(grace.getByRole("link", { name: "Back to your boards" })).toContainText("Offline")
  p = await at(grace, 310, 150)
  await grace.mouse.dblclick(p.x, p.y)
  await grace.keyboard.press("End")
  await grace.keyboard.type(" from Grace")
  await grace.keyboard.press("Escape")
  await grace.keyboard.press("Escape")
  await drag(grace, { x: 350, y: 285 }, { x: 350, y: 420 }) // rectangle A down
  p = await at(grace, 350, 420)
  await grace.mouse.click(p.x, p.y)
  p = await at(grace, 600, 285)
  await grace.keyboard.down("Shift")
  await grace.mouse.click(p.x, p.y)
  await grace.keyboard.up("Shift")
  await grace.keyboard.press("Control+g")
  await grace.keyboard.press("Escape")
  await grace.keyboard.press("s")
  p = await at(grace, 950, 180)
  await grace.mouse.click(p.x, p.y)
  await grace.keyboard.type("offline note")
  await grace.keyboard.press("Escape")
  await grace.keyboard.press("Escape")

  // Meanwhile Ada edits the same text, deletes the sticky, and draws another rectangle.
  p = await at(ada, 310, 150)
  await ada.mouse.dblclick(p.x, p.y)
  await ada.keyboard.press("Home")
  await ada.keyboard.type("Ada: ")
  await ada.keyboard.press("Escape")
  await ada.keyboard.press("Escape")
  p = await at(ada, 800, 450)
  await ada.mouse.click(p.x, p.y)
  await ada.keyboard.press("Delete")
  await ada.keyboard.press("r")
  await drag(ada, { x: 300, y: 560 }, { x: 380, y: 620 })

  // A long session: past presence timeouts, before the token's 5 minutes run out.
  await grace.waitForTimeout(35_000)
  await contextG.setOffline(false)
  await waitUntilOnline(grace)

  // Both converge, and every edit from both sides is there.
  await expect
    .poll(async () => JSON.stringify(await all(grace)) === JSON.stringify(await all(ada)), {
      timeout: 20_000,
    })
    .toBe(true)
  const merged = await all(ada)
  expect(merged.filter((e) => e.type === "text").map((e) => e.text)).toEqual([
    "Ada: hello from Grace",
  ])
  expect(merged.filter((e) => e.type === "sticky").map((e) => e.text)).toEqual(["offline note"])
  const rects = merged.filter((e) => e.type === "rect")
  expect(rects).toHaveLength(3)
  const movedA = rects.find((e) => e.id === rectA?.id)
  expect(movedA?.position?.y).toBe((rectA?.y ?? 0) + 135)
  const grouped = rects.filter((e) => e.groupId)
  expect(grouped).toHaveLength(2)
  expect(new Set(grouped.map((e) => e.groupId)).size).toBe(1)
  const connector = merged.find((e) => e.type === "connector")
  expect(grouped.map((e) => e.id).sort()).toEqual(
    [connector?.start?.elementId, connector?.end?.elementId].sort(),
  )

  await contextA.close()
  await contextG.close()
})
