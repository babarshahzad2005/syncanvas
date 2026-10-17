import { expect, type Page, test } from "@playwright/test"
import { connectDb } from "./db"
import { addComment, invite, pinOf, signIn, waitUntilOnline } from "./helpers"

// M5a ticket 03: the Owner deletes a Board while a Collaborator has it open, restores it from
// Trash, and deletes another forever. Past 50 owned Boards, creating one is refused.

const tiles = (page: Page) => page.getByRole("main").getByRole("link", { name: /Edited/ })

async function newBoard(page: Page, title: string) {
  await page.goto("/")
  await page.getByRole("button", { name: "Blank board" }).click()
  await page.waitForURL(/\/b\//)
  await waitUntilOnline(page)
  const url = page.url()
  const boardId = new URL(url).pathname.split("/").at(-1)
  const res = await page.request.patch(`/api/boards/${boardId}`, { data: { title } })
  expect(res.ok()).toBe(true)
  return url
}

test("delete closes a Collaborator's Board; restore and delete forever from Trash", async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const stamp = Date.now()
  const graceEmail = `e2e-trash-grace-${stamp}@example.com`
  const grace = await (await browser.newContext()).newPage()
  await signIn(grace, graceEmail, { name: "Grace Hopper" })
  const ada = await (await browser.newContext()).newPage()
  await signIn(ada, `e2e-trash-ada-${stamp}@example.com`, { name: "Ada Lovelace" })

  const retro = await newBoard(ada, "Retro")
  await invite(ada, graceEmail, "editor")
  await grace.goto(retro)
  await waitUntilOnline(grace)
  await addComment(grace, { x: 300, y: 250 }, "Keep this")

  // Ada deletes it from the Board menu: Grace is sent home at once.
  await ada.goto(retro)
  await waitUntilOnline(ada)
  await ada.getByRole("button", { name: "Board menu" }).click()
  await ada.getByRole("menuitem", { name: "Delete board…" }).click()
  await ada.getByRole("dialog").getByRole("button", { name: "Delete board" }).click()
  await ada.waitForURL((url) => url.pathname === "/")
  await expect(ada.getByText("“Retro” moved to Trash")).toBeVisible()
  await grace.waitForURL((url) => url.pathname === "/")
  await expect(grace.getByText("“Retro” was deleted")).toBeVisible()
  await expect(tiles(grace)).toHaveCount(0)

  // Restored from Trash: Grace has it back, with her comment.
  await ada.getByRole("button", { name: "Account" }).click()
  await ada.getByRole("menuitem", { name: "Trash" }).click()
  await ada.waitForURL(/\/trash$/)
  await expect(ada.getByRole("main")).toContainText("Deleted just now · 30 days left")
  await ada.getByRole("button", { name: "Restore Retro" }).click()
  await expect(ada.getByText("Trash is empty.")).toBeVisible()
  await grace.reload()
  await expect(tiles(grace)).toHaveCount(1)
  await tiles(grace).first().click()
  await waitUntilOnline(grace)
  await expect(pinOf(grace, "Keep this")).toBeVisible()

  // Another Board, deleted from its tile, then deleted forever.
  await newBoard(ada, "Scratch")
  await ada.goto("/")
  await ada.getByRole("button", { name: "Actions for Scratch" }).click()
  await ada.getByRole("menuitem", { name: "Delete board…" }).click()
  await ada.getByRole("dialog").getByRole("button", { name: "Delete board" }).click()
  await expect(tiles(ada).filter({ hasText: "Scratch" })).toHaveCount(0)
  await ada.goto("/trash")
  await ada.getByRole("button", { name: "Delete Scratch forever" }).click()
  await ada.getByRole("dialog").getByRole("button", { name: "Delete forever" }).click()
  await expect(ada.getByText("Trash is empty.")).toBeVisible()

  for (const page of [ada, grace]) await page.context().close()
})

test("creating a 51st owned Board is refused", async ({ page }) => {
  test.setTimeout(120_000)
  const email = `e2e-quota-${Date.now()}@example.com`
  await signIn(page, email, { name: "Quota Test" })
  const sql = connectDb()
  if (!sql) throw new Error("no dev database configured")
  await sql`
    insert into boards (id, owner_id, title)
    select 'e2e-quota-' || u.id || '-' || n, u.id, 'Seed ' || n
    from "user" u, generate_series(1, 50) n where u.email = ${email}
  `
  await sql.end()
  await page.goto("/")
  await page.getByRole("button", { name: "Blank board" }).click()
  await expect(page.getByRole("alert")).toHaveText(
    "You own 50 boards, the most for one account. Delete one or empty Trash to make room.",
  )
  await expect(page).toHaveURL((url) => url.pathname === "/")
})
