import { statSync } from "node:fs"
import { expect, type Page, test } from "@playwright/test"
import { drag, elements, enableTestHooks, invite, signIn, waitUntilOnline } from "./helpers"

// M3 ticket 05 (FLOWS §2 "Go offline and reconnect"): someone who loses access while offline
// is told on reconnect. With edits the room never got, they're offered a picture first.

async function setup(browser: import("@playwright/test").Browser) {
  const stamp = Date.now()
  const graceEmail = `e2e-grace-${stamp}@example.com`
  const grace = await (await browser.newContext()).newPage()
  await enableTestHooks(grace)
  await signIn(grace, graceEmail, { name: "Grace Hopper" })

  const ada = await (await browser.newContext()).newPage()
  await signIn(ada, `e2e-ada-${stamp}@example.com`, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)
  await invite(ada, graceEmail, "editor")

  await grace.goto(ada.url())
  await waitUntilOnline(grace)
  const boardId = new URL(ada.url()).pathname.split("/").at(-1) ?? ""

  /** Ada removes Grace through the API, as the Share dialog's Remove does. */
  async function removeGrace() {
    const state = (await (await ada.request.get(`/api/boards/${boardId}/sharing`)).json()) as {
      members: { id: string; email: string }[]
    }
    const id = state.members.find((m) => m.email === graceEmail)?.id
    const res = await ada.request.delete(`/api/boards/${boardId}/members/${id}`)
    expect(res.ok()).toBe(true)
  }
  return { ada, grace, boardId, removeGrace }
}

const localCopyExists = (page: Page, boardId: string) =>
  page.evaluate(
    async (name) => (await indexedDB.databases()).some((db) => db.name === name),
    `syncanvas-board-${boardId}`,
  )

test("removed while offline with unsaved edits: a picture is offered, then the copy goes", async ({
  browser,
}) => {
  test.setTimeout(150_000)
  const { ada, grace, boardId, removeGrace } = await setup(browser)

  // Grace goes offline and keeps drawing; meanwhile Ada removes her.
  await grace.context().setOffline(true)
  await expect(grace.getByRole("link", { name: "Back to your boards" })).toContainText("Offline")
  await grace.keyboard.press("r")
  await drag(grace, { x: 400, y: 300 }, { x: 560, y: 400 })
  await expect.poll(() => elements(grace)).toHaveLength(1)
  await removeGrace()

  // Back online: she's told, and offered a picture of her copy.
  await grace.context().setOffline(false)
  const dialog = grace.getByRole("dialog", {
    name: "You no longer have access to “Untitled board”",
  })
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await expect(dialog).toContainText("Changes you made while offline couldn't be saved")
  const download = grace.waitForEvent("download")
  await dialog.getByRole("button", { name: "Download a picture" }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe("Untitled board.png")
  expect(statSync(await file.path()).size).toBeGreaterThan(500)
  expect(await localCopyExists(grace, boardId)).toBe(true) // kept until she's done

  // Discarding clears the copy and goes to the dashboard.
  await dialog.getByRole("button", { name: "Discard and close" }).click()
  await grace.waitForURL((url) => url.pathname === "/")
  await expect(grace.getByText("You no longer have access to “Untitled board”")).toBeVisible()
  await expect.poll(() => localCopyExists(grace, boardId)).toBe(false)
  expect(await elements(ada)).toEqual([]) // her rectangle never reached the Board

  for (const page of [ada, grace]) await page.context().close()
})

test("removed while offline with nothing unsaved: back to the dashboard with the toast", async ({
  browser,
}) => {
  test.setTimeout(150_000)
  const { ada, grace, boardId, removeGrace } = await setup(browser)
  await grace.context().setOffline(true)
  await expect(grace.getByRole("link", { name: "Back to your boards" })).toContainText("Offline")
  await removeGrace()
  await grace.context().setOffline(false)
  await grace.waitForURL((url) => url.pathname === "/", { timeout: 20_000 })
  await expect(grace.getByText("You no longer have access to “Untitled board”")).toBeVisible()
  await expect.poll(() => localCopyExists(grace, boardId)).toBe(false)
  for (const page of [ada, grace]) await page.context().close()
})
