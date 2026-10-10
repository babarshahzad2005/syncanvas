import { expect, type Page, test } from "@playwright/test"
import { connectDb } from "./db"
import { drag, elements, enableTestHooks, signIn, waitUntilOnline } from "./helpers"

async function newBoard(page: Page) {
  await page.getByRole("button", { name: "Blank board" }).click()
  await page.waitForURL(/\/b\//)
  await waitUntilOnline(page)
}

test("a Board opened before shows its local copy before the network answers", async ({ page }) => {
  await enableTestHooks(page)
  await signIn(page, `e2e-local-${Date.now()}@example.com`)
  await newBoard(page)
  await page.keyboard.press("r")
  await drag(page, { x: 500, y: 300 }, { x: 640, y: 400 })
  await expect.poll(() => elements(page)).toHaveLength(1)

  // Hold the board token for a while, so only the local copy can supply the content.
  await page.route("**/api/boards/*/token", async (route) => {
    await new Promise((r) => setTimeout(r, 4000))
    await route.continue()
  })
  await page.reload()
  const pill = page.getByRole("link", { name: "Back to your boards" })
  await expect(pill).toContainText("Connecting")
  await expect.poll(() => elements(page), { timeout: 3000 }).toHaveLength(1)
  await expect(pill).toContainText("Connecting") // still waiting on the network
  await waitUntilOnline(page)
})

test("edits made offline merge with everyone else's on reconnect", async ({ browser }) => {
  const email = `e2e-offline-${Date.now()}@example.com`
  const contextA = await browser.newContext()
  const a = await contextA.newPage()
  await enableTestHooks(a)
  await signIn(a, email)
  await newBoard(a)

  const contextB = await browser.newContext({ storageState: await contextA.storageState() })
  const b = await contextB.newPage()
  await enableTestHooks(b)
  await b.goto(a.url())
  await waitUntilOnline(b)

  // A loses the network and keeps drawing.
  await contextA.setOffline(true)
  await expect(a.getByRole("link", { name: "Back to your boards" })).toContainText("Offline")
  await a.keyboard.press("r")
  await drag(a, { x: 300, y: 300 }, { x: 420, y: 380 }) // 120 wide
  await expect.poll(() => elements(a)).toHaveLength(1)

  // Meanwhile B draws online, and A can't see it yet.
  await b.keyboard.press("r")
  await drag(b, { x: 700, y: 300 }, { x: 790, y: 380 }) // 90 wide
  await expect.poll(() => elements(b)).toHaveLength(1)
  await new Promise((r) => setTimeout(r, 500))
  expect(await elements(a)).toHaveLength(1)

  // A reconnects: both end up with both rectangles.
  await contextA.setOffline(false)
  await waitUntilOnline(a)
  const widths = async (p: Page) => (await elements(p)).map((e) => e.w).sort((x, y) => x - y)
  await expect.poll(() => widths(a)).toEqual([90, 120])
  await expect.poll(() => widths(b)).toEqual([90, 120])

  await contextA.close()
  await contextB.close()
})

test("losing access clears the local copy and explains why", async ({ page }) => {
  await enableTestHooks(page)
  const email = `e2e-revoked-${Date.now()}@example.com`
  await signIn(page, email)
  await newBoard(page)
  const boardId = page.url().split("/b/")[1] ?? ""
  await page.keyboard.press("r")
  await drag(page, { x: 500, y: 300 }, { x: 640, y: 400 })
  await expect.poll(() => elements(page)).toHaveLength(1)

  const localCopyExists = () =>
    page.evaluate(
      async (name) => (await indexedDB.databases()).some((db) => db.name === name),
      `syncanvas-board-${boardId}`,
    )
  await expect.poll(localCopyExists).toBe(true)

  // Remove the Membership directly (removing Members from the UI arrives in M3).
  const sql = connectDb()
  if (!sql) throw new Error("no database connection")
  await sql`delete from memberships where board_id = ${boardId}`
  await sql.end()

  await page.reload()
  await expect(
    page.getByRole("heading", { name: "You don't have access to this board" }),
  ).toBeVisible()
  await expect.poll(localCopyExists).toBe(false)
})
