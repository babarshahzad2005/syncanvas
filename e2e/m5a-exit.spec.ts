import { expect, type Page, test } from "@playwright/test"
import { addComment, invite, pinOf, signIn, waitUntilOnline } from "./helpers"

// M5a exit check (spec: Testing; ticket 06): a new User makes a Board from a template,
// renames, files, and stars it, and sees its thumbnail first in last-opened order. Deleting it
// closes a Collaborator's open Board; Restore brings it back with Members and Threads.
// Deleting the account removes its Boards and leaves its comments as "Deleted user".

const tiles = (page: Page) => page.getByRole("main").getByRole("link", { name: /Edited/ })
const boardIdOf = (page: Page) => new URL(page.url()).pathname.split("/").at(-1) ?? ""

async function renameTile(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: `Actions for ${from}` }).click()
  await page.getByRole("menuitem", { name: "Rename…" }).click()
  const dialog = page.getByRole("dialog", { name: "Rename board" })
  await dialog.getByLabel("Title").fill(to)
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog).toBeHidden()
}

test("M5a exit check", async ({ browser }) => {
  test.setTimeout(600_000)
  const stamp = Date.now()
  const adaEmail = `e2e-m5a-ada-${stamp}@example.com`
  const graceEmail = `e2e-m5a-grace-${stamp}@example.com`
  const grace = await (await browser.newContext()).newPage()
  await signIn(grace, graceEmail, { name: "Grace Hopper" })
  const ada = await (await browser.newContext()).newPage()
  await signIn(ada, adaEmail, { name: "Ada Lovelace" })

  // An older Board, opened first.
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)
  await ada.getByRole("link", { name: "Back to your boards" }).click()
  await renameTile(ada, "Untitled board", "Scratch")

  // From a template, renamed from the Board menu, and shared.
  await ada.getByRole("button", { name: "Kanban", exact: true }).click()
  await ada.waitForURL(/\/b\/[^?]+$/)
  await waitUntilOnline(ada)
  const sprintId = boardIdOf(ada)
  await ada.getByRole("button", { name: "Board menu" }).click()
  await ada.getByRole("menuitem", { name: "Rename…" }).click()
  const rename = ada.getByRole("dialog", { name: "Rename board" })
  await rename.getByLabel("Title").fill("Sprint board")
  await rename.getByRole("button", { name: "Save" }).click()
  await expect(ada.getByRole("link", { name: "Back to your boards" })).toContainText("Sprint board")
  await invite(ada, graceEmail, "editor")

  // Back home: its thumbnail, first in last-opened order.
  await ada.getByRole("link", { name: "Back to your boards" }).click()
  await expect(tiles(ada).first()).toContainText("Sprint board")
  await expect(tiles(ada).nth(1)).toContainText("Scratch")
  const thumb = ada.locator(`a[href="/b/${sprintId}"] img`)
  await expect(thumb).toHaveAttribute("src", /^\/api\/assets\/thumbs\//)
  await expect
    .poll(() => thumb.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)

  // Starred and filed.
  await ada.getByRole("button", { name: "Actions for Sprint board" }).click()
  await ada.getByRole("menuitem", { name: "Add to favorites" }).click()
  await expect(tiles(ada).first().getByLabel("Favorite")).toBeVisible()
  await ada.getByRole("button", { name: "New folder" }).click()
  const folder = ada.getByRole("dialog", { name: "New folder" })
  await folder.getByLabel("Name").fill("Q4")
  await folder.getByRole("button", { name: "Create folder" }).click()
  await ada.getByRole("button", { name: "Actions for Sprint board" }).click()
  await ada.getByRole("menuitem", { name: "Move to folder" }).click()
  await ada.getByRole("menuitemradio", { name: "Q4" }).click()
  await expect(ada.locator('[data-folder="Q4"]')).toContainText("1 board")

  // Grace comments on it; Ada deletes it, and Grace's open Board closes at once.
  await grace.goto(`/b/${sprintId}`)
  await waitUntilOnline(grace)
  await addComment(grace, { x: 300, y: 250 }, "Ship it")
  await ada.getByRole("button", { name: "Actions for Sprint board" }).click()
  await ada.getByRole("menuitem", { name: "Delete board…" }).click()
  await ada.getByRole("dialog").getByRole("button", { name: "Delete board" }).click()
  await grace.waitForURL((url) => url.pathname === "/")
  await expect(grace.getByText("“Sprint board” was deleted")).toBeVisible()

  // Restored: Grace is still a Member, and her Thread is there.
  await ada.goto("/trash")
  await ada.getByRole("button", { name: "Restore Sprint board" }).click()
  await expect(ada.getByText("Trash is empty.")).toBeVisible()
  await grace.reload()
  await tiles(grace).filter({ hasText: "Sprint board" }).click()
  await waitUntilOnline(grace)
  await expect(pinOf(grace, "Ship it")).toBeVisible()

  // Ada comments on a Board of Grace's.
  await grace.goto("/")
  await grace.getByRole("button", { name: "Blank board" }).click()
  await grace.waitForURL(/\/b\//)
  await waitUntilOnline(grace)
  const graceBoard = grace.url()
  await invite(grace, adaEmail, "commenter")
  await ada.goto(graceBoard)
  await waitUntilOnline(ada)
  await addComment(ada, { x: 300, y: 250 }, "Looks good")

  // Ada deletes her account: typed confirmation, then signed out.
  await ada.goto("/")
  await ada.getByRole("button", { name: "Account" }).click()
  await ada.getByRole("menuitem", { name: "Settings" }).click()
  await ada
    .getByRole("dialog", { name: "Settings" })
    .getByRole("button", { name: "Delete account…" })
    .click()
  const confirm = ada.getByRole("dialog", { name: "Delete your account?" })
  await expect(confirm).toContainText("2 boards you own will be deleted for everyone.")
  const button = confirm.getByRole("button", { name: "Delete account" })
  await expect(button).toBeDisabled()
  await confirm.getByLabel("Type DELETE to confirm").fill("delete")
  await expect(button).toBeDisabled()
  await confirm.getByLabel("Type DELETE to confirm").fill("DELETE")
  await button.click()
  await ada.waitForURL(/\/sign-in/)
  await expect(ada.getByRole("status")).toHaveText("Your account was deleted.")

  // Grace: Ada's Boards are gone; Ada's comment stays, as "Deleted user".
  await grace.goto("/")
  await expect(tiles(grace)).toHaveCount(1)
  await expect(tiles(grace).filter({ hasText: "Sprint board" })).toHaveCount(0)
  await grace.goto(graceBoard)
  await waitUntilOnline(grace)
  const pin = pinOf(grace, "Looks good")
  await expect(pin).toHaveAccessibleName(/^Comment by Deleted user: /)
  await pin.click()
  await expect(grace.getByRole("region", { name: "Comment thread" })).toContainText("Deleted user")

  for (const page of [ada, grace]) await page.context().close()
})
