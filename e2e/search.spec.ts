import { expect, test } from "@playwright/test"
import { enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M5b ticket 05: a word written on a sticky note finds its Board from the dashboard's search,
// opened with the keyboard; nobody else finds it.

test("search finds a Board by the text on a sticky note, and only for its Members", async ({
  browser,
}) => {
  const stamp = Date.now()
  // A word no other test data has: letters only, so the index keeps it whole.
  const word = `zebra${stamp.toString(36).replace(/\d/g, "")}`
  const context = await browser.newContext()
  const ada = await context.newPage()
  await enableTestHooks(ada)
  await signIn(ada, `e2e-ada-${stamp}@example.com`)
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)
  const boardUrl = ada.url()

  // A sticky note with the word, then indexing now (instead of the 5-minute alarm).
  await ada.keyboard.press("s")
  await ada.mouse.click(640, 400)
  await ada.keyboard.type(`Plan the ${word} launch`)
  await ada.keyboard.press("Escape")
  await expect
    .poll(async () =>
      ada.evaluate(() => window.__syncanvas?.elements().some((e) => e.text?.includes("launch"))),
    )
    .toBe(true)
  const boardId = new URL(boardUrl).pathname.split("/").at(-1)
  await expect
    .poll(async () => (await ada.request.post(`/api/dev/compact/${boardId}`)).ok())
    .toBe(true)

  // From the dashboard: `/` focuses the box; the result shows the matched word in bold.
  await ada.goto("/")
  await expect(ada.getByRole("button", { name: "Blank board" })).toBeVisible()
  await ada.keyboard.press("/")
  await expect(ada.getByRole("combobox", { name: "Search boards" })).toBeFocused()
  await ada.keyboard.type(word)
  const results = ada.getByRole("listbox", { name: "Matching boards" })
  await expect(results.getByRole("option")).toHaveCount(1)
  await expect(results.locator("strong")).toHaveText(word)
  await ada.keyboard.press("ArrowDown") // wraps back to the only result
  await ada.keyboard.press("Enter")
  await ada.waitForURL(boardUrl)

  // Someone else searching for the same word finds nothing.
  const other = await browser.newContext()
  const grace = await other.newPage()
  await signIn(grace, `e2e-grace-${stamp}@example.com`)
  await grace.getByRole("combobox", { name: "Search boards" }).fill(word)
  await expect(grace.getByText(`No boards match “${word}”.`)).toBeVisible()

  await context.close()
  await other.close()
})
