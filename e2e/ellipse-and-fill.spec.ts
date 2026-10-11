import { expect, test } from "@playwright/test"
import { drag, elements, enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M1 ticket 03: ellipses and shape fills sync live between two browsers.

test("an ellipse drawn in one browser, refilled in the other", async ({ browser }) => {
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

  // A picks the ellipse from the dock and draws; the tool returns to select afterwards.
  await a.getByRole("button", { name: "Ellipse" }).click()
  await drag(a, { x: 500, y: 300 }, { x: 700, y: 420 })
  await expect(a.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => elements(b)).toHaveLength(1)
  expect((await elements(b))[0]).toMatchObject({ type: "ellipse", w: 200, h: 120, fill: "light" })

  // B selects it (clicking its middle) and makes it solid; A sees the new fill.
  await drag(b, { x: 600, y: 360 }, { x: 600, y: 360 })
  await expect(b.getByRole("button", { name: "Light fill" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await b.getByRole("button", { name: "Solid fill" }).click()
  await expect.poll(async () => (await elements(a))[0]?.fill).toBe("solid")

  // Clicking the empty corner of its box (outside the ellipse) selects nothing.
  await drag(b, { x: 505, y: 305 }, { x: 505, y: 305 })
  await expect(b.getByRole("toolbar", { name: "Style" })).toBeHidden()

  // O draws another ellipse straight from the keyboard.
  await b.keyboard.press("o")
  await drag(b, { x: 200, y: 200 }, { x: 260, y: 260 })
  await expect
    .poll(async () => (await elements(a)).map((e) => e.type))
    .toEqual(["ellipse", "ellipse"])

  await contextA.close()
  await contextB.close()
})
