import { expect, test } from "@playwright/test"
import { signIn } from "./helpers"

// M2 ticket 01: a User without a name is asked once, and can change it later.

test("a new User picks a display name once, and can change it", async ({ page }) => {
  await signIn(page, `e2e-ada.lovelace-${Date.now()}@example.com`, { name: null })

  // Opening a Board asks, prefilled from the email.
  await page.getByRole("button", { name: "Blank board" }).click()
  await page.waitForURL(/\/b\//)
  const dialog = page.getByRole("dialog", { name: "What should others see?" })
  await expect(dialog).toBeVisible()
  const field = dialog.getByLabel("Name")
  await expect(field).toHaveValue(/^E2e Ada Lovelace/)

  // An empty name is refused; a real one is saved.
  await field.fill("   ")
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog.getByRole("alert")).toHaveText("Names are 1–50 characters.")
  await field.fill("Ada Lovelace")
  await dialog.getByRole("button", { name: "Save" }).click()
  await expect(dialog).toBeHidden()

  // Coming back doesn't ask again.
  await page.reload()
  await expect(page.getByLabel("Board canvas")).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.getByRole("dialog")).toBeHidden()

  // The account menu shows it, and "Display name…" changes it.
  await page.goto("/")
  const account = page.getByRole("button", { name: "Account" })
  await expect(account).toHaveText("AL")
  await account.click()
  await expect(page.getByRole("menu")).toContainText("Ada Lovelace")
  await page.getByRole("menuitem", { name: "Display name…" }).click()
  const rename = page.getByRole("dialog", { name: "Display name" })
  await rename.getByLabel("Name").fill("Countess Lovelace")
  await rename.getByRole("button", { name: "Save" }).click()
  await expect(rename).toBeHidden()
  await expect(account).toHaveText("CL")
})

test("skipping keeps the name from the email", async ({ page }) => {
  await signIn(page, `e2e-grace.hopper-${Date.now()}@example.com`, { name: null })
  await page.getByRole("button", { name: "Blank board" }).click()
  await page.waitForURL(/\/b\//)
  const dialog = page.getByRole("dialog", { name: "What should others see?" })
  await dialog.getByRole("button", { name: "Skip for now" }).click()
  await expect(dialog).toBeHidden()
  await page.goto("/")
  await page.getByRole("button", { name: "Account" }).click()
  await expect(page.getByRole("menu")).toContainText("E2e Grace Hopper")
})
