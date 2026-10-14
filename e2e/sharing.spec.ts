import { expect, test } from "@playwright/test"
import { signIn, waitUntilOnline } from "./helpers"

// M3 ticket 01: the Owner invites people by email from the Share dialog.

test("the Owner invites an existing account and a new address", async ({ browser }) => {
  test.setTimeout(120_000) // two sign-ins against a possibly cold Neon
  const stamp = Date.now()
  const adaEmail = `e2e-ada-${stamp}@example.com`
  const graceEmail = `e2e-grace-${stamp}@example.com`
  const newEmail = `e2e-new-${stamp}@example.com`

  // Grace already has an account.
  const contextG = await browser.newContext()
  const grace = await contextG.newPage()
  await signIn(grace, graceEmail, { name: "Grace Hopper" })
  await expect(grace.getByText("Q4 retro")).toBeHidden()

  const contextA = await browser.newContext()
  const ada = await contextA.newPage()
  await signIn(ada, adaEmail, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)

  // Invite Grace as a Viewer.
  await ada.getByRole("button", { name: "Share" }).click()
  const dialog = ada.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: /^Share “/ })).toBeVisible()
  const people = dialog.getByRole("region", { name: "People with access" })
  await expect(people.getByRole("listitem")).toHaveCount(1)
  await expect(people).toContainText("Ada Lovelace (you)")
  await dialog.getByLabel("Email address").fill(graceEmail)
  await dialog.getByRole("button", { name: "Role: Editor" }).click()
  await ada.getByRole("menuitemradio", { name: /Viewer/ }).click()
  await dialog.getByRole("button", { name: "Send", exact: true }).click()
  await expect(ada.getByText(`${graceEmail} can view now`)).toBeVisible()
  await expect(people.getByRole("listitem").filter({ hasText: "Grace Hopper" })).toContainText(
    "Viewer",
  )
  await expect(dialog.getByLabel("Email address")).toHaveValue("")

  // Inviting her again is refused with a clear message.
  await dialog.getByLabel("Email address").fill(graceEmail)
  await dialog.getByRole("button", { name: "Send", exact: true }).click()
  await expect(dialog.getByRole("alert")).toHaveText(
    "Grace Hopper already has access to this board.",
  )

  // A new address stays pending, and can be cancelled.
  await dialog.getByLabel("Email address").fill(newEmail)
  await dialog.getByRole("button", { name: "Send", exact: true }).click()
  const pending = people.getByRole("listitem").filter({ hasText: newEmail })
  await expect(pending).toContainText("Pending · invited by Ada Lovelace")
  await expect(pending).toContainText("Viewer") // the Role menu keeps the last pick
  await pending.getByRole("button", { name: `Cancel invitation to ${newEmail}` }).click()
  await expect(pending).toBeHidden()
  await expect(people.getByRole("listitem")).toHaveCount(2)

  // Grace sees the Board on her dashboard and opens it, view-only.
  await grace.reload()
  await grace.getByRole("link", { name: /Untitled board/ }).click()
  await grace.waitForURL(ada.url())
  await waitUntilOnline(grace)
  await expect(grace.getByRole("link", { name: "Back to your boards" })).toContainText("View only")
  // She can see who has access, but not invite.
  await grace.getByRole("button", { name: "Share" }).click()
  const hers = grace.getByRole("dialog")
  await expect(hers).toContainText("Only the owner and editors can invite people.")
  await expect(hers.getByLabel("Email address")).toBeHidden()
  await expect(hers.getByRole("listitem")).toHaveCount(2)

  await contextA.close()
  await contextG.close()
})
