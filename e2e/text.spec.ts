import { expect, type Page, test } from "@playwright/test"
import { enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M1 ticket 06: text typed on the canvas, merged when two people type at once (ADR 0009).

async function texts(page: Page) {
  return page.evaluate(
    () =>
      window.__syncanvas?.elements().flatMap((e) => (e.type === "text" ? [e.text ?? ""] : [])) ??
      [],
  )
}

async function canvasPoint(page: Page, x: number, y: number) {
  const box = await page.getByLabel("Board canvas").boundingBox()
  if (!box) throw new Error("canvas not visible")
  return { x: box.x + x, y: box.y + y }
}

async function openBoard(page: Page, email: string) {
  await enableTestHooks(page)
  await signIn(page, email)
  await page.getByRole("button", { name: "Blank board" }).click()
  await page.waitForURL(/\/b\//)
  await waitUntilOnline(page)
}

test("two people typing in the same text both keep their words", async ({ browser }) => {
  const email = `e2e-${Date.now()}@example.com`
  const contextA = await browser.newContext()
  const a = await contextA.newPage()
  await openBoard(a, email)

  const contextB = await browser.newContext({ storageState: await contextA.storageState() })
  const b = await contextB.newPage()
  await enableTestHooks(b)
  await b.goto(a.url())
  await waitUntilOnline(b)

  // A places a text and types into it.
  await a.keyboard.press("t")
  const spot = await canvasPoint(a, 300, 200)
  await a.mouse.click(spot.x, spot.y)
  await a.keyboard.type("hello")
  await expect.poll(() => texts(b)).toEqual(["hello"])

  // B opens the same text (A is still editing), moves to the start, and both type at once.
  const spotB = await canvasPoint(b, 315, 200)
  await b.mouse.dblclick(spotB.x, spotB.y)
  await expect(b.getByRole("textbox", { name: "Text" })).toBeFocused()
  await b.keyboard.press("Control+Home")
  await Promise.all([
    a.keyboard.type(" alpha", { delay: 60 }),
    b.keyboard.type("beta ", { delay: 60 }),
  ])

  await expect.poll(() => texts(a)).toEqual(["beta hello alpha"])
  await expect.poll(() => texts(b)).toEqual(["beta hello alpha"])
  // Each editor shows the merged text too, not just the document.
  await expect(a.getByRole("textbox", { name: "Text" })).toHaveValue("beta hello alpha")
  await expect(b.getByRole("textbox", { name: "Text" })).toHaveValue("beta hello alpha")

  await contextA.close()
  await contextB.close()
})

test("typing undoes in bursts, and empty texts disappear", async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await openBoard(page, `e2e-${Date.now()}@example.com`)
  const editor = page.getByRole("textbox", { name: "Text" })

  // A text left empty is removed when editing ends.
  await page.keyboard.press("t")
  const empty = await canvasPoint(page, 300, 400)
  await page.mouse.click(empty.x, empty.y)
  await expect(editor).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(editor).toBeHidden()
  expect(await texts(page)).toEqual([])

  // Two bursts of typing with a pause between: undo removes the last burst, then the rest
  // together with the text itself; redo brings back the first burst.
  await page.keyboard.press("t")
  const spot = await canvasPoint(page, 300, 200)
  await page.mouse.click(spot.x, spot.y)
  await page.keyboard.type("one")
  await page.waitForTimeout(800)
  await page.keyboard.type(" two")
  await page.keyboard.press("Control+z")
  await expect(editor).toHaveValue("one")
  await page.keyboard.press("Control+z")
  await expect.poll(() => texts(page)).toEqual([])
  await page.keyboard.press("Control+Shift+z")
  await expect.poll(() => texts(page)).toEqual(["one"])

  // Selecting a text and typing starts editing at the end.
  await page.mouse.click(spot.x + 10, spot.y)
  await page.keyboard.type("!")
  await expect(editor).toHaveValue("one!")
  await page.keyboard.press("Escape")
  await expect.poll(() => texts(page)).toEqual(["one!"])

  // The tray styles the whole text.
  await page.getByRole("button", { name: "Size XL" }).click()
  await page.getByRole("button", { name: "Bold" }).click()
  await page.getByRole("button", { name: "Align right" }).click()
  await expect
    .poll(() =>
      page.evaluate(() => window.__syncanvas?.elements().map((e) => [e.fontSize, e.bold, e.align])),
    )
    .toEqual([["XL", true, "right"]])

  await context.close()
})
