import { expect, type Page, test } from "@playwright/test"
import { drag, elements, enableTestHooks, invite, signIn, waitUntilOnline } from "./helpers"

// M3 ticket 02 (S7): the Owner's Role changes and removals reach the other person's screen
// within 1 s, without a refresh; Members can leave from the Share dialog or the dashboard.

test("downgrade, upgrade, and removal take effect at once", async ({ browser }) => {
  test.setTimeout(150_000)
  const stamp = Date.now()
  const graceEmail = `e2e-grace-${stamp}@example.com`

  const contextG = await browser.newContext()
  const grace = await contextG.newPage()
  await enableTestHooks(grace)
  await signIn(grace, graceEmail, { name: "Grace Hopper" })

  const contextA = await browser.newContext()
  const ada = await contextA.newPage()
  await enableTestHooks(ada)
  await signIn(ada, `e2e-ada-${stamp}@example.com`, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)
  await invite(ada, graceEmail, "editor")

  await grace.goto(ada.url())
  await waitUntilOnline(grace)
  const rectangle = grace.getByRole("toolbar", { name: "Tools" }).getByLabel("Rectangle")
  await expect(rectangle).toBeEnabled()

  // Ada makes Grace a Viewer from the Share dialog.
  await ada.getByRole("button", { name: "Share" }).click()
  const dialog = ada.getByRole("dialog")
  await dialog.getByRole("button", { name: "Grace Hopper's role: Editor" }).click()
  // S7 counts from the moment the change is saved (the API's answer) to Grace's screen.
  const downgrade = savedAccessChange(ada)
  await ada.getByRole("menuitemradio", { name: /Viewer/ }).click()
  const downgraded = await downgrade
  await expect(rectangle).toBeDisabled({ timeout: 10_000 })
  expect(Date.now() - downgraded).toBeLessThan(1_000)
  await expect(grace.getByText("Ada Lovelace changed your role to Viewer")).toBeVisible()
  await expect(grace.getByRole("link", { name: "Back to your boards" })).toContainText("View only")
  await expect(dialog.getByRole("button", { name: "Grace Hopper's role: Viewer" })).toBeVisible()

  // Her drawing shortcut does nothing now, and nothing reaches Ada.
  await grace.keyboard.press("r")
  await drag(grace, { x: 300, y: 200 }, { x: 420, y: 300 })
  await grace.waitForTimeout(500)
  expect(await elements(ada)).toEqual([])

  // Back to Editor: the tools return, with a toast.
  await dialog.getByRole("button", { name: "Grace Hopper's role: Viewer" }).click()
  const upgrade = savedAccessChange(ada)
  await ada.getByRole("menuitemradio", { name: /Editor/ }).click()
  const upgraded = await upgrade
  await expect(rectangle).toBeEnabled({ timeout: 10_000 })
  expect(Date.now() - upgraded).toBeLessThan(1_000)
  await expect(grace.getByText("Ada Lovelace changed your role to Editor")).toBeVisible()
  await grace.keyboard.press("r")
  await drag(grace, { x: 300, y: 200 }, { x: 420, y: 300 })
  await expect.poll(async () => (await elements(ada)).length).toBe(1)

  // Removed: she's on her dashboard within a second, told why, and the Board is gone.
  await dialog.getByRole("button", { name: "Grace Hopper's role: Editor" }).click()
  const removal = savedAccessChange(ada)
  await ada.getByRole("menuitem", { name: "Remove" }).click()
  const removed = await removal
  await grace.waitForURL((url) => url.pathname === "/", { timeout: 10_000 })
  expect(Date.now() - removed).toBeLessThan(1_000)
  await expect(grace.getByText(/You no longer have access to “Untitled board”/)).toBeVisible()
  await expect(grace.getByRole("link", { name: /Untitled board/ })).toBeHidden()
  await expect(ada.getByText("Grace Hopper no longer has access")).toBeVisible()

  await contextA.close()
  await contextG.close()
})

test("Members leave from the Share dialog or the dashboard", async ({ browser }) => {
  test.setTimeout(150_000)
  const stamp = Date.now()
  const graceEmail = `e2e-grace-${stamp}@example.com`

  const contextG = await browser.newContext()
  const grace = await contextG.newPage()
  await signIn(grace, graceEmail, { name: "Grace Hopper" })

  const contextA = await browser.newContext()
  const ada = await contextA.newPage()
  await signIn(ada, `e2e-ada-${stamp}@example.com`, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)
  await invite(ada, graceEmail, "viewer")

  // From the Share dialog, after confirming.
  await grace.goto(ada.url())
  await waitUntilOnline(grace)
  await grace.getByRole("button", { name: "Share" }).click()
  await grace.getByRole("dialog").getByRole("button", { name: "Leave board" }).click()
  await confirmLeave(grace)
  await grace.waitForURL((url) => url.pathname === "/")
  await expect(grace.getByText("You left “Untitled board”")).toBeVisible()
  await expect(grace.getByRole("link", { name: /Untitled board/ })).toBeHidden()

  // From the dashboard tile's ⋯ menu.
  await invite(ada, graceEmail, "viewer")
  await grace.reload()
  await grace.getByRole("button", { name: "Actions for Untitled board" }).click()
  await grace.getByRole("menuitem", { name: "Leave board" }).click()
  await confirmLeave(grace)
  await expect(grace.getByText("You left “Untitled board”")).toBeVisible()
  await expect(grace.getByRole("link", { name: /Untitled board/ })).toBeHidden()

  // The Owner sees only herself left.
  await ada.getByRole("button", { name: "Share" }).click()
  await expect(ada.getByRole("dialog").getByRole("listitem")).toHaveCount(1)
  // And the Owner can't leave.
  await expect(ada.getByRole("dialog").getByRole("button", { name: "Leave board" })).toBeHidden()

  await contextA.close()
  await contextG.close()
})

/** Resolves with the time the next Role change or removal was saved. */
async function savedAccessChange(page: Page) {
  await page.waitForResponse((res) => /\/api\/boards\/[^/]+\/members\//.test(res.url()) && res.ok())
  return Date.now()
}

async function confirmLeave(page: Page) {
  const confirm = page.getByRole("dialog", { name: /^Leave “/ })
  await expect(confirm).toContainText("you'll need a new invitation")
  await confirm.getByRole("button", { name: "Leave board" }).click()
}
