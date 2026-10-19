import { expect, type Page, test } from "@playwright/test"
import { drag, enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M5b ticket 01: a Board with more than 500 edits compacts in its room and reloads identical.

const snapshot = (page: Page) =>
  page.evaluate(() =>
    (window.__syncanvas?.elements() ?? [])
      .map((e) => JSON.stringify([e.id, e.type, e.position, e.size, e.color]))
      .sort(),
  )

test("500+ edits compact and the Board reloads identical", async ({ browser }) => {
  test.setTimeout(240_000)
  const page = await (await browser.newContext()).newPage()
  await enableTestHooks(page)
  await signIn(page, `e2e-compact-${Date.now()}@example.com`, { name: "Ada Lovelace" })
  await page.getByRole("button", { name: "Blank board" }).click()
  await page.waitForURL(/\/b\//)
  await waitUntilOnline(page)
  const boardId = new URL(page.url()).pathname.split("/").at(-1) ?? ""

  // Two rectangles, then 520 one-step nudges of the selected one: each is its own update.
  for (const at of [100, 300]) {
    await page.keyboard.press("r")
    await drag(page, { x: at, y: 150 }, { x: at + 120, y: 230 })
  }
  const rightmost = () =>
    page.evaluate(() =>
      Math.max(...(window.__syncanvas?.elements() ?? []).map((e) => e.position?.x ?? 0)),
    )
  const start = await rightmost()
  for (let i = 0; i < 520; i++) await page.keyboard.press("ArrowRight")
  await expect.poll(rightmost).toBe(start + 520)
  const before = await snapshot(page)
  expect(before).toHaveLength(2)

  // Leave time for the last updates to reach the room, then compact what's left.
  await page.waitForTimeout(1_000)
  const res = await page.request.post(`/api/dev/compact/${boardId}`)
  expect(await res.json()).toEqual({ pending: 0 })

  // A fresh browser with only the session: no local copy can fill in what the room lost.
  const fresh = await (
    await browser.newContext({ storageState: await page.context().storageState() })
  ).newPage()
  await enableTestHooks(fresh)
  await fresh.goto(`/b/${boardId}`)
  await waitUntilOnline(fresh)
  await expect.poll(() => snapshot(fresh)).toEqual(before)
  for (const p of [page, fresh]) await p.context().close()
})
