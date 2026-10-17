import { expect, type Page, test } from "@playwright/test"
import { signIn, waitUntilOnline } from "./helpers"

// M5a ticket 02: private Folders. Make one, move Boards in from the tile menu or by dragging,
// open its page, rename it, and delete it with its Boards kept.

const tiles = (page: Page) => page.getByRole("main").getByRole("link", { name: /Edited/ })
const folderTile = (page: Page, name: string) => page.locator(`[data-folder="${name}"]`)

async function newBoard(page: Page, title: string) {
  await page.goto("/")
  await page.getByRole("button", { name: "Blank board" }).click()
  await page.waitForURL(/\/b\//)
  await waitUntilOnline(page)
  await page.goto("/")
  await page.getByRole("button", { name: "Actions for Untitled board" }).click()
  await page.getByRole("menuitem", { name: "Rename…" }).click()
  const dialog = page.getByRole("dialog", { name: "Rename board" })
  await dialog.getByLabel("Title").fill(title)
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog).toBeHidden()
}

test("folders: create, move by menu and drag, rename, delete", async ({ browser }) => {
  test.setTimeout(180_000)
  const page = await (await browser.newContext()).newPage()
  await signIn(page, `e2e-folders-${Date.now()}@example.com`, { name: "Ada Lovelace" })
  await newBoard(page, "Roadmap")
  await newBoard(page, "Retro")

  await page.getByRole("button", { name: "New folder" }).click()
  const create = page.getByRole("dialog", { name: "New folder" })
  await create.getByLabel("Name").fill("Product")
  await create.getByRole("button", { name: "Create folder" }).click()
  await expect(folderTile(page, "Product")).toContainText("0 boards")

  // From the tile menu.
  await page.getByRole("button", { name: "Actions for Roadmap" }).click()
  await page.getByRole("menuitem", { name: "Move to folder" }).click()
  await page.getByRole("menuitemradio", { name: "Product" }).click()
  await expect(folderTile(page, "Product")).toContainText("1 board")

  // By dragging the tile onto the Folder.
  await tiles(page).filter({ hasText: "Retro" }).dragTo(folderTile(page, "Product"))
  await expect(folderTile(page, "Product")).toContainText("2 boards")

  // The Folder's page lists just its Boards.
  await folderTile(page, "Product").getByRole("link").click()
  await page.waitForURL(/\/folders\//)
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Product")
  await expect(tiles(page)).toHaveCount(2)
  await page.getByRole("button", { name: "Actions for Retro" }).click()
  await page.getByRole("menuitem", { name: "Move to folder" }).click()
  await page.getByRole("menuitemradio", { name: "No folder" }).click()
  await expect(tiles(page)).toHaveCount(1)
  await page.getByRole("link", { name: "Home" }).click()

  // Rename, then delete: the Boards stay on home.
  await folderTile(page, "Product")
    .getByRole("button", { name: /Actions for folder/ })
    .click()
  await page.getByRole("menuitem", { name: "Rename…" }).click()
  const rename = page.getByRole("dialog", { name: "Rename folder" })
  await rename.getByLabel("Name").fill("Planning")
  await rename.getByRole("button", { name: "Save" }).click()
  await expect(folderTile(page, "Planning")).toContainText("1 board")
  await folderTile(page, "Planning")
    .getByRole("button", { name: /Actions for folder/ })
    .click()
  await page.getByRole("menuitem", { name: "Delete folder" }).click()
  await page.getByRole("button", { name: "Delete folder" }).click()
  await expect(folderTile(page, "Planning")).toHaveCount(0)
  await expect(tiles(page)).toHaveCount(2)

  await page.context().close()
})
