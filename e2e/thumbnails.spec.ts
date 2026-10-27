import { expect, type Page, test } from "@playwright/test"
import { enableTestHooks, invite, signIn, waitUntilOnline } from "./helpers"

// M5a ticket 05: leaving a Board you changed uploads its thumbnail, and the dashboard tile
// shows it. Someone who can't edit never uploads, but still sees the picture.

/** Every thumbnail upload the page sends. */
function uploadsFrom(page: Page) {
  const sent: string[] = []
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/thumbnail")) sent.push(r.url())
  })
  return sent
}

/**
 * The tile's picture has loaded from our thumbnail URL. The upload, then the dashboard's
 * refresh, can take longer than the default 5 s on a busy machine (it once failed right after
 * the long exit specs).
 */
async function expectThumbnail(page: Page, boardId: string) {
  const img = page.locator(`a[href="/b/${boardId}"] img`)
  await expect(img).toHaveAttribute("src", new RegExp(`^/api/assets/thumbs/${boardId}\\?v=`), {
    timeout: 20_000,
  })
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 20_000 })
    .toBeGreaterThan(0)
}

test("an Editor leaving a changed Board updates its tile; a Viewer leaving doesn't upload", async ({
  browser,
}) => {
  test.setTimeout(150_000)
  const stamp = Date.now()
  const graceEmail = `e2e-thumb-grace-${stamp}@example.com`
  const grace = await (await browser.newContext()).newPage()
  await enableTestHooks(grace)
  await signIn(grace, graceEmail, { name: "Grace Hopper" })
  const ada = await (await browser.newContext()).newPage()
  await enableTestHooks(ada)
  await signIn(ada, `e2e-thumb-ada-${stamp}@example.com`, { name: "Ada Lovelace" })
  const adaUploads = uploadsFrom(ada)
  const graceUploads = uploadsFrom(grace)

  // The template's Elements are Ada's first edit.
  await ada.getByRole("button", { name: "Kanban", exact: true }).click()
  await ada.waitForURL(/\/b\/[^?]+$/)
  await waitUntilOnline(ada)
  const boardId = new URL(ada.url()).pathname.split("/").pop() ?? ""
  await expect
    .poll(() => ada.evaluate(() => window.__syncanvas?.elements().length))
    .toBeGreaterThan(0)
  await invite(ada, graceEmail, "viewer")

  await ada.getByRole("link", { name: "Back to your boards" }).click()
  await expect.poll(() => adaUploads.length).toBe(1)
  await expectThumbnail(ada, boardId)

  // Grace can only view: opening and leaving sends nothing, but her tile shows Ada's picture.
  await grace.goto(`/b/${boardId}`)
  await waitUntilOnline(grace)
  await grace.getByRole("link", { name: "Back to your boards" }).click()
  await expectThumbnail(grace, boardId)
  expect(graceUploads).toEqual([])

  // Opening and leaving without changing anything doesn't upload again.
  await ada.locator(`a[href="/b/${boardId}"]`).click()
  await waitUntilOnline(ada)
  await ada.getByRole("link", { name: "Back to your boards" }).click()
  await expectThumbnail(ada, boardId)
  expect(adaUploads).toHaveLength(1)

  for (const page of [ada, grace]) await page.context().close()
})
