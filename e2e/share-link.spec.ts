import { expect, type Page, test } from "@playwright/test"
import { finishSignIn, signIn, waitUntilOnline } from "./helpers"

// M3 ticket 03: the Owner's Share Link makes whoever opens it a lasting Member.

test("people join through the Share Link, and a regenerated link retires the old one", async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const stamp = Date.now()

  const ada = await (await browser.newContext()).newPage()
  await signIn(ada, `e2e-ada-${stamp}@example.com`, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)
  const boardUrl = ada.url()

  // Ada turns the link on (Viewer, never expiring), then lets it edit.
  await ada.getByRole("button", { name: "Share" }).click()
  const dialog = ada.getByRole("dialog")
  const toggle = dialog.getByRole("switch", { name: "Share link" })
  await expect(toggle).not.toBeChecked()
  await toggle.click()
  await expect(toggle).toBeChecked()
  await expect(dialog.getByRole("button", { name: "Link role: Viewer" })).toBeVisible()
  await expect(dialog).toContainText("Never expires")
  const viewLink = await linkAddress(ada)
  await dialog.getByRole("button", { name: "Link role: Viewer" }).click()
  await ada.getByRole("menuitemradio", { name: /Editor/ }).click()
  await expect(dialog.getByRole("button", { name: "Link role: Editor" })).toBeVisible()
  const editLink = await linkAddress(ada)
  expect(editLink).not.toBe(viewLink) // a new Role is a new token

  // An expiry shows its date.
  await dialog.getByRole("button", { name: "Link expiry" }).click()
  await ada.getByRole("menuitem", { name: "7 days" }).click()
  await expect(dialog).toContainText(/Expires [A-Z][a-z]{2} \d{1,2}/)
  expect(await linkAddress(ada)).toBe(editLink)

  // Grace, signed in, opens it: she's an Editor, and the token leaves the address bar.
  const grace = await (await browser.newContext()).newPage()
  await signIn(grace, `e2e-grace-${stamp}@example.com`, { name: "Grace Hopper" })
  await grace.goto(editLink)
  await grace.waitForURL(boardUrl)
  await waitUntilOnline(grace)
  await expect(grace.getByRole("toolbar", { name: "Tools" }).getByLabel("Rectangle")).toBeEnabled()
  await grace.goto("/")
  await expect(grace.getByRole("link", { name: /Untitled board/ })).toBeVisible()

  // Linus isn't signed in: he looks as a Guest (ticket 04), signs in from the button, and
  // lands back on the Board as a Member.
  const linus = await (await browser.newContext()).newPage()
  await linus.goto(editLink)
  await linus.getByRole("link", { name: "Sign in to edit" }).click()
  await linus.waitForURL(/\/sign-in\?redirect=/)
  await finishSignIn(linus, `e2e-linus-${stamp}@example.com`)
  await linus.waitForURL(boardUrl)
  await ada.reload()
  await ada.getByRole("button", { name: "Share" }).click()
  await expect(ada.getByRole("dialog").getByRole("listitem")).toHaveCount(3)

  // Regenerating retires the old address.
  await ada.getByRole("dialog").getByRole("button", { name: "Regenerate" }).click()
  await expect.poll(() => linkAddress(ada)).not.toBe(editLink)
  const stranger = await (await browser.newContext()).newPage()
  await signIn(stranger, `e2e-stranger-${stamp}@example.com`, { name: "Stranger" })
  await stranger.goto(editLink)
  await expect(stranger.getByRole("heading", { name: "This link doesn't work" })).toBeVisible()

  // Turning the link off keeps the people who joined.
  await ada.getByRole("dialog").getByRole("switch", { name: "Share link" }).click()
  await expect(ada.getByRole("dialog")).toContainText("Off. Only the people above")
  await expect(ada.getByRole("dialog").getByRole("listitem")).toHaveCount(3)

  for (const page of [ada, grace, linus, stranger]) await page.context().close()
})

async function linkAddress(page: Page) {
  return page.getByRole("dialog").getByLabel("Share link address").inputValue()
}
