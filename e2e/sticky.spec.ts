import { expect, type Page, test } from "@playwright/test"
import { enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M1 ticket 07: sticky notes, typed in together, growing with their text.

async function stickies(page: Page) {
  return page.evaluate(
    () => window.__syncanvas?.elements().filter((e) => e.type === "sticky") ?? [],
  )
}

async function canvasPoint(page: Page, x: number, y: number) {
  const box = await page.getByLabel("Board canvas").boundingBox()
  if (!box) throw new Error("canvas not visible")
  return { x: box.x + x, y: box.y + y }
}

test("a sticky made in one window is typed in from another", async ({ browser }) => {
  const contextA = await browser.newContext()
  const a = await contextA.newPage()
  await enableTestHooks(a)
  await signIn(a, `e2e-${Date.now()}@example.com`)
  await a.getByRole("button", { name: "Blank board" }).click()
  await a.waitForURL(/\/b\//)
  await waitUntilOnline(a)

  const contextB = await browser.newContext({ storageState: await contextA.storageState() })
  const b = await contextB.newPage()
  await enableTestHooks(b)
  await b.goto(a.url())
  await waitUntilOnline(b)

  // A places a note with S and leaves it empty: an empty sticky stays (unlike text).
  await a.keyboard.press("s")
  const spot = await canvasPoint(a, 300, 250)
  await a.mouse.click(spot.x, spot.y)
  const editorA = a.getByRole("textbox", { name: "Text" })
  await expect(editorA).toBeFocused()
  await a.keyboard.press("Escape")
  await expect(editorA).toBeHidden()
  await expect.poll(async () => (await stickies(b)).length).toBe(1)

  // B opens it and types; A sees the words.
  const spotB = await canvasPoint(b, 300, 250)
  await b.mouse.dblclick(spotB.x, spotB.y)
  await expect(b.getByRole("textbox", { name: "Text" })).toBeFocused()
  await b.keyboard.type("from B")
  await expect.poll(async () => (await stickies(a)).map((s) => s.text)).toEqual(["from B"])

  // The note grows taller as lines are added (the size is recorded when editing ends).
  for (let i = 0; i < 12; i++) await b.keyboard.press("Enter")
  await b.keyboard.type("end")
  await b.keyboard.press("Escape")
  await expect.poll(async () => (await stickies(a))[0]?.size?.h ?? 0).toBeGreaterThan(250)

  // The tray: sticky colors, sizes S/M/L (no XL), bold, and no alignment.
  await a.mouse.click(spot.x, spot.y)
  await a.getByRole("button", { name: "Color pink" }).click()
  await a.getByRole("button", { name: "Size L" }).click()
  await a.getByRole("button", { name: "Bold" }).click()
  await expect(a.getByRole("button", { name: "Size XL" })).toHaveCount(0)
  await expect(a.getByRole("button", { name: "Align left" })).toHaveCount(0)
  await expect(a.getByRole("button", { name: "Color ink" })).toHaveCount(0)
  await expect
    .poll(async () => (await stickies(b)).map((s) => [s.color, s.fontSize, s.bold]))
    .toEqual([["pink", "L", true]])

  // The next note takes the color picked last.
  await a.keyboard.press("Escape")
  await a.keyboard.press("s")
  const next = await canvasPoint(a, 650, 250)
  await a.mouse.click(next.x, next.y)
  await a.keyboard.type("next")
  await a.keyboard.press("Escape")
  await expect
    .poll(async () => (await stickies(b)).map((s) => [s.color, s.text]))
    .toEqual([
      ["pink", "from B\n\n\n\n\n\n\n\n\n\n\n\nend"],
      ["pink", "next"],
    ])

  await contextA.close()
  await contextB.close()
})
