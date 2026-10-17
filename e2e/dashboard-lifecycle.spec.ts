import { expect, type Page, test } from "@playwright/test"
import { invite, signIn, waitUntilOnline } from "./helpers"

// M5a ticket 01: the dashboard sorts by last opened; the Owner and Editors rename from the
// tile or the Board menu (live for whoever has it open); favorites are starred and filtered.

const tiles = (page: Page) => page.getByRole("main").getByRole("link", { name: /Edited/ })

async function newBoard(page: Page) {
  await page.goto("/")
  await page.getByRole("button", { name: "Blank board" }).click()
  await page.waitForURL(/\/b\//)
  await waitUntilOnline(page)
  return page.url()
}

async function renameFromTile(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: `Actions for ${from}` }).click()
  await page.getByRole("menuitem", { name: "Rename…" }).click()
  const dialog = page.getByRole("dialog", { name: "Rename board" })
  await dialog.getByLabel("Title").fill(to)
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog).toBeHidden()
}

test("the dashboard sorts by last opened; rename and favorites", async ({ browser }) => {
  test.setTimeout(180_000)
  const stamp = Date.now()
  const graceEmail = `e2e-grace-${stamp}@example.com`
  const grace = await (await browser.newContext()).newPage()
  await signIn(grace, graceEmail, { name: "Grace Hopper" })

  const ada = await (await browser.newContext()).newPage()
  await signIn(ada, `e2e-ada-${stamp}@example.com`, { name: "Ada Lovelace" })

  // Two Boards, renamed from their tiles; the one opened last comes first.
  const first = await newBoard(ada)
  await ada.goto("/")
  await renameFromTile(ada, "Untitled board", "Alpha")
  const second = await newBoard(ada)
  await ada.goto("/")
  await renameFromTile(ada, "Untitled board", "Beta")
  await expect(tiles(ada).first()).toContainText("Beta")
  await ada.goto(first)
  await waitUntilOnline(ada)
  await ada.goto("/")
  await expect(tiles(ada).first()).toContainText("Alpha")
  await expect(tiles(ada).nth(1)).toContainText("Beta")

  // Renaming from the Board menu reaches an Editor who has it open.
  await ada.goto(second)
  await waitUntilOnline(ada)
  await invite(ada, graceEmail, "editor")
  await grace.goto(second)
  await waitUntilOnline(grace)
  await ada.getByRole("button", { name: "Board menu" }).click()
  await ada.getByRole("menuitem", { name: "Rename…" }).click()
  const dialog = ada.getByRole("dialog", { name: "Rename board" })
  await dialog.getByLabel("Title").fill("Beta, final")
  await dialog.getByRole("button", { name: "Save" }).click()
  const pill = (page: Page) => page.getByRole("link", { name: "Back to your boards" })
  await expect(pill(ada)).toContainText("Beta, final")
  await expect(pill(grace)).toContainText("Beta, final")

  // Favorites: starred from the tile, shown with a star, and filtered.
  await ada.goto("/")
  await ada.getByRole("button", { name: "Actions for Alpha" }).click()
  await ada.getByRole("menuitem", { name: "Add to favorites" }).click()
  await expect(tiles(ada).filter({ hasText: "Alpha" }).getByLabel("Favorite")).toBeVisible()
  await ada.getByRole("tab", { name: "Favorites" }).click()
  await expect(tiles(ada)).toHaveCount(1)
  await expect(tiles(ada).first()).toContainText("Alpha")
  // Grace's favorites are her own.
  await grace.goto("/")
  await grace.getByRole("tab", { name: "Favorites" }).click()
  await expect(tiles(grace)).toHaveCount(0)

  for (const page of [ada, grace]) await page.context().close()
})
