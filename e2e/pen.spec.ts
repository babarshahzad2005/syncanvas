import { expect, test } from "@playwright/test"
import { elements, enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M1 ticket 04: freehand strokes sync with the same points, and the pen stays active.

test("a pen stroke drawn in one browser appears in the other", async ({ browser }) => {
  const email = `e2e-${Date.now()}@example.com`

  const contextA = await browser.newContext()
  const a = await contextA.newPage()
  await enableTestHooks(a)
  await signIn(a, email)
  await a.getByRole("button", { name: "Blank board" }).click()
  await a.waitForURL(/\/b\//)
  await waitUntilOnline(a)

  const contextB = await browser.newContext({ storageState: await contextA.storageState() })
  const b = await contextB.newPage()
  await enableTestHooks(b)
  await b.goto(a.url())
  await waitUntilOnline(b)

  // With the pen active, the tray sets the next strokes' color and width.
  await a.keyboard.press("p")
  await a.getByRole("button", { name: "Color red" }).click()
  await a.getByRole("button", { name: "Thick" }).click()

  // A scribbles a wave.
  const box = await a.getByLabel("Board canvas").boundingBox()
  if (!box) throw new Error("canvas not visible")
  await a.mouse.move(box.x + 300, box.y + 300)
  await a.mouse.down()
  for (let i = 1; i <= 30; i++) {
    await a.mouse.move(box.x + 300 + i * 10, box.y + 300 + Math.sin(i / 3) * 40)
  }
  await a.mouse.up()

  await expect.poll(() => elements(b)).toHaveLength(1)
  const [seen] = await elements(b)
  const [drawn] = await elements(a)
  expect(seen).toMatchObject({ type: "pen", color: "red" })
  expect(seen?.points).toEqual(drawn?.points)
  expect(seen?.points?.length).toBeGreaterThan(3) // the curve survived simplification

  // The pen stays active: a second stroke right away.
  await expect(a.getByRole("button", { name: "Pen" })).toHaveAttribute("aria-pressed", "true")
  await a.mouse.move(box.x + 300, box.y + 500)
  await a.mouse.down()
  await a.mouse.move(box.x + 450, box.y + 520, { steps: 6 })
  await a.mouse.up()
  await expect.poll(async () => (await elements(b)).length).toBe(2)

  // B selects the first stroke by clicking on its line and makes it thin.
  const firstY = 300 + Math.sin(10 / 3) * 40
  await b.mouse.click(box.x + 400, box.y + firstY)
  await b.getByRole("button", { name: "Thin" }).click()
  await expect
    .poll(() => a.evaluate(() => window.__syncanvas?.elements().map((e) => e.width)))
    .toEqual(["S", "L"])

  await contextA.close()
  await contextB.close()
})
