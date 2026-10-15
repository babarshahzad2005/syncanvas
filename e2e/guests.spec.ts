import { expect, test } from "@playwright/test"
import { finishSignIn, shareLinkOf, signIn, waitUntilOnline } from "./helpers"

// M3 ticket 04: a signed-out visitor sees the Board from a Share Link as a gray "Guest N",
// signs in from the button to become a Member, and is cut off when the link goes off.

test("a Guest views, shows up as Guest 1, and signs in to join", async ({ browser }) => {
  test.setTimeout(150_000)
  const stamp = Date.now()
  const ada = await (await browser.newContext()).newPage()
  await signIn(ada, `e2e-ada-${stamp}@example.com`, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)
  const boardUrl = ada.url()
  const link = await shareLinkOf(ada, "editor")

  // Not signed in: the Board opens right away, view-only, with "Sign in to edit".
  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto(link)
  await waitUntilOnline(visitor)
  expect(visitor.url()).toBe(link)
  await expect(visitor.getByRole("link", { name: "Back to your boards" })).toContainText(
    "View only",
  )
  await expect(
    visitor.getByRole("toolbar", { name: "Tools" }).getByLabel("Rectangle"),
  ).toBeDisabled()
  await expect(visitor.getByRole("button", { name: "Share" })).toBeHidden()

  // Ada sees a gray Guest 1 she can't follow.
  const guest = ada.getByRole("region", { name: "People on this board" }).getByRole("button", {
    name: "Guest 1",
  })
  await expect(guest).toBeVisible()
  await expect(guest).toHaveAttribute("aria-disabled", "true")

  // Signing in brings the visitor back to the Board as an Editor.
  await visitor.getByRole("link", { name: "Sign in to edit" }).click()
  await visitor.waitForURL(/\/sign-in\?redirect=/)
  await finishSignIn(visitor, `e2e-grace-${stamp}@example.com`)
  await visitor.waitForURL(boardUrl)
  // A brand-new account is asked for its name first (M2).
  const nameDialog = visitor.getByRole("dialog", { name: "What should others see?" })
  await nameDialog.getByLabel("Name").fill("Grace Hopper")
  await nameDialog.getByRole("button", { name: "Save" }).click()
  await waitUntilOnline(visitor)
  await expect(
    visitor.getByRole("toolbar", { name: "Tools" }).getByLabel("Rectangle"),
  ).toBeEnabled()
  await expect(guest).toBeHidden()
  await expect(
    ada.getByRole("region", { name: "People on this board" }).getByRole("button", {
      name: /Grace/, // as a Member now (the name in her pass is the email's until she reconnects)
    }),
  ).toBeVisible()

  for (const page of [ada, visitor]) await page.context().close()
})

test("turning the link off disconnects Guests", async ({ browser }) => {
  test.setTimeout(120_000)
  const stamp = Date.now()
  const ada = await (await browser.newContext()).newPage()
  await signIn(ada, `e2e-ada-${stamp}@example.com`, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)
  const link = await shareLinkOf(ada, "viewer")

  const visitor = await (await browser.newContext()).newPage()
  await visitor.goto(link)
  await waitUntilOnline(visitor)
  await expect(visitor.getByRole("link", { name: "Sign in", exact: true })).toBeVisible()

  await ada.getByRole("button", { name: "Share" }).click()
  await ada.getByRole("dialog").getByRole("switch", { name: "Share link" }).click()
  await expect(
    visitor.getByRole("heading", { name: "This link doesn't work anymore" }),
  ).toBeVisible()
  await expect(
    ada.getByRole("region", { name: "People on this board" }).getByRole("button", {
      name: "Guest 1",
    }),
  ).toBeHidden()

  // Opening it again doesn't work either.
  await visitor.reload()
  await expect(
    visitor.getByRole("heading", { name: "This link doesn't work anymore" }),
  ).toBeVisible()

  for (const page of [ada, visitor]) await page.context().close()
})
