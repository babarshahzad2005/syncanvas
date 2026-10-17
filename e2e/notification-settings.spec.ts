import { expect, type Page, test } from "@playwright/test"
import { signIn } from "./helpers"

// M4 ticket 04: the digest switch saves and survives a reload; a digest's unsubscribe link
// asks first, then turns digests off.

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Account" }).click()
  await page.getByRole("menuitem", { name: "Notifications…" }).click()
  const dialog = page.getByRole("dialog", { name: "Notifications" })
  const toggle = dialog.getByRole("switch", { name: "Email me about unread notifications" })
  await expect(toggle).toBeEnabled()
  return { dialog, toggle }
}

test("digest emails are switched off in settings, or with the unsubscribe link", async ({
  page,
}) => {
  const email = `e2e-digest-${Date.now()}@example.com`
  await signIn(page, email)

  // On by default; off sticks across a reload.
  let { toggle } = await openSettings(page)
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await page.keyboard.press("Escape")
  await page.reload()
  ;({ toggle } = await openSettings(page))
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await page.keyboard.press("Escape")

  // The link in a digest: a page that asks first, then one button.
  const res = await page.request.get(`/api/dev/unsubscribe-link?email=${encodeURIComponent(email)}`)
  expect(res.ok()).toBe(true)
  const { url } = (await res.json()) as { url: string }
  await page.goto(url)
  await expect(page.getByRole("heading", { name: "Stop digest emails?" })).toBeVisible()
  await page.getByRole("button", { name: "Stop digest emails" }).click()
  await expect(page.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible()

  await page.goto("/")
  ;({ toggle } = await openSettings(page))
  await expect(toggle).not.toBeChecked()
})
