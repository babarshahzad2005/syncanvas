import { expect, type Page, test } from "@playwright/test"
import { enableTestHooks, invite, signIn, waitUntilOnline } from "./helpers"

// M5a ticket 04: a Board made from a template starts with the template's Elements, as an
// ordinary first edit: everyone sees them, and undo takes them away.

/** The text of every text Element and sticky note on the Board, sorted. */
const texts = (page: Page) =>
  page.evaluate(() =>
    (window.__syncanvas?.elements() ?? [])
      .flatMap((e) => ("text" in e && typeof e.text === "string" && e.text ? [e.text] : []))
      .sort(),
  )

test("creating from Kanban gives its columns, shared live, and undo removes them", async ({
  browser,
}) => {
  test.setTimeout(150_000)
  const stamp = Date.now()
  const graceEmail = `e2e-tpl-grace-${stamp}@example.com`
  const grace = await (await browser.newContext()).newPage()
  await enableTestHooks(grace)
  await signIn(grace, graceEmail, { name: "Grace Hopper" })
  const ada = await (await browser.newContext()).newPage()
  await enableTestHooks(ada)
  await signIn(ada, `e2e-tpl-ada-${stamp}@example.com`, { name: "Ada Lovelace" })

  await ada.getByRole("button", { name: "Kanban", exact: true }).click()
  await ada.waitForURL(/\/b\/[^?]+$/) // the template parameter is gone once applied
  await waitUntilOnline(ada)
  await expect(ada.getByRole("link", { name: "Back to your boards" })).toContainText("Kanban")
  await expect
    .poll(() => texts(ada))
    .toEqual(expect.arrayContaining(["To do", "In progress", "Done"]))
  const all = await texts(ada)

  await invite(ada, graceEmail, "viewer")
  await grace.goto(ada.url())
  await waitUntilOnline(grace)
  await expect.poll(() => texts(grace)).toEqual(all)

  // One undo takes the whole template away, for everyone.
  await ada.getByLabel("Board canvas").click({ position: { x: 5, y: 5 } })
  await ada.keyboard.press("Control+z")
  await expect.poll(() => texts(ada)).toEqual([])
  await expect.poll(() => texts(grace)).toEqual([])

  // Opening it again doesn't apply the template a second time.
  await ada.reload()
  await waitUntilOnline(ada)
  await expect.poll(() => texts(ada)).toEqual([])

  for (const page of [ada, grace]) await page.context().close()
})
