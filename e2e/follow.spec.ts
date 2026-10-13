import { expect, type Page, test } from "@playwright/test"
import { enableTestHooks, shareBoard, signIn, waitUntilOnline } from "./helpers"

// M2 ticket 05: following someone makes your view track theirs until you take over.

async function camera(page: Page) {
  const c = await page.evaluate(() => window.__syncanvas?.camera())
  return c ? { x: Math.round(c.x), y: Math.round(c.y), zoom: Math.round(c.zoom * 100) / 100 } : null
}

async function pan(page: Page, dx: number, dy: number) {
  const box = await page.getByLabel("Board canvas").boundingBox()
  await page.mouse.move((box?.x ?? 0) + 640, (box?.y ?? 0) + 400)
  await page.mouse.wheel(dx, dy)
}

test("following someone tracks their view until you pan", async ({ browser }) => {
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

  // Ada pans away first; Grace follows her and jumps to Ada's view.
  await pan(ada, 300, 200)
  await grace.getByRole("button", { name: "Ada Lovelace" }).click()
  const chip = grace.getByRole("status").filter({ hasText: "Following Ada Lovelace" })
  await expect(chip).toBeVisible()
  await expect.poll(() => camera(grace)).toEqual(await camera(ada))

  // Ada pans and zooms: Grace's view keeps up (same screen size, so the same camera).
  await pan(ada, -500, 150)
  await expect.poll(() => camera(grace)).toEqual(await camera(ada))
  await ada.keyboard.down("Control")
  await ada.mouse.wheel(0, -200)
  await ada.keyboard.up("Control")
  await expect.poll(async () => (await camera(ada))?.zoom).not.toBe(1)
  await expect.poll(() => camera(grace)).toEqual(await camera(ada))

  // Grace pans: following ends, and Ada's next pan no longer moves her.
  await pan(grace, 100, 0)
  await expect(chip).toBeHidden()
  const mine = await camera(grace)
  await pan(ada, 400, 0)
  await ada.waitForTimeout(500)
  expect(await camera(grace)).toEqual(mine)

  // Escape ends it too; so does Stop; and the leader leaving.
  await grace.getByRole("button", { name: "Ada Lovelace" }).click()
  await expect(chip).toBeVisible()
  await grace.keyboard.press("Escape")
  await expect(chip).toBeHidden()
  await grace.getByRole("button", { name: "Ada Lovelace" }).click()
  await chip.getByRole("button", { name: "Stop" }).click()
  await expect(chip).toBeHidden()
  await grace.getByRole("button", { name: "Ada Lovelace" }).click()
  await expect(chip).toBeVisible()
  await contextA.close()
  await expect(chip).toBeHidden()

  await contextG.close()
})
