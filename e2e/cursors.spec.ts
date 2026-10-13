import { expect, type Page, test } from "@playwright/test"
import { enableTestHooks, shareBoard, signIn, waitUntilOnline } from "./helpers"

// M2 ticket 03: live cursors in the presence color with names, away, and offline.

async function canvasPoint(page: Page, x: number, y: number) {
  const box = await page.getByLabel("Board canvas").boundingBox()
  return { x: (box?.x ?? 0) + x, y: (box?.y ?? 0) + y }
}

/** Where a remote cursor points (its tip), in page px. */
async function cursorTip(page: Page, name: string) {
  const box = await page.locator(`[data-cursor="${name}"]`).boundingBox()
  return box ? { x: Math.round(box.x), y: Math.round(box.y) } : null
}

/** Pretends the tab went to the background (or came back). */
async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (h ? "hidden" : "visible"),
    })
    document.dispatchEvent(new Event("visibilitychange"))
  }, hidden)
}

test("cursors move live with names, and hide when someone is away", async ({ browser }) => {
  // Two sign-ins, a second tab, and an offline round trip: longer than the 60 s default.
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

  // Ada moves over the Board: her cursor appears for Grace at the same spot (both windows
  // start with the same camera), with her name.
  const to = await canvasPoint(ada, 400, 300)
  await ada.mouse.move(to.x, to.y, { steps: 5 })
  const expected = await canvasPoint(grace, 400, 300)
  await expect
    .poll(() => cursorTip(grace, "Ada Lovelace"))
    .toEqual({ x: Math.round(expected.x), y: Math.round(expected.y) })
  await expect(grace.locator('[data-cursor="Ada Lovelace"]')).toContainText("Ada Lovelace")

  // It follows her.
  const next = await canvasPoint(ada, 650, 200)
  await ada.mouse.move(next.x, next.y, { steps: 5 })
  const nextExpected = await canvasPoint(grace, 650, 200)
  await expect
    .poll(() => cursorTip(grace, "Ada Lovelace"))
    .toEqual({ x: Math.round(nextExpected.x), y: Math.round(nextExpected.y) })

  // Ada switches tabs: her cursor hides and her avatar shows her away. Back, she's back.
  await setHidden(ada, true)
  await expect(grace.locator('[data-cursor="Ada Lovelace"]')).toBeHidden()
  await expect(grace.getByRole("img", { name: "Ada Lovelace (away)" })).toBeVisible()
  await setHidden(ada, false)
  await ada.mouse.move(to.x, to.y, { steps: 3 })
  await expect(grace.getByRole("img", { name: "Ada Lovelace", exact: true })).toBeVisible()
  await expect(grace.locator('[data-cursor="Ada Lovelace"]')).toBeVisible()

  // Ada sees her own other tab's cursor, but never the one under her own pointer.
  const adaAgain = await contextA.newPage()
  await adaAgain.goto(ada.url())
  await waitUntilOnline(adaAgain)
  const there = await canvasPoint(adaAgain, 300, 450)
  await adaAgain.mouse.move(there.x, there.y, { steps: 3 })
  await expect(ada.locator('[data-cursor="Ada Lovelace"]')).toBeVisible()
  await expect(adaAgain.locator('[data-cursor="Ada Lovelace"]')).toHaveCount(1) // the first tab's

  // Grace goes offline: everyone's cursors leave her screen until she's back.
  await contextG.setOffline(true)
  await expect(grace.locator("[data-cursor]")).toHaveCount(0)
  await contextG.setOffline(false)
  await waitUntilOnline(grace)
  await ada.mouse.move(next.x, next.y, { steps: 3 })
  await expect(grace.locator('[data-cursor="Ada Lovelace"]').first()).toBeVisible()

  await contextA.close()
  await contextG.close()
})
