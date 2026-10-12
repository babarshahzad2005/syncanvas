import { expect, type Page, test } from "@playwright/test"
import { drag, elements, enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M1 ticket 12: connectors attach to shapes, follow them, and outlive them.

async function connector(page: Page) {
  return page.evaluate(() => window.__syncanvas?.elements().find((e) => e.type === "connector"))
}

test("a connector follows a shape moved in the other browser", async ({ browser }) => {
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

  // A draws two rectangles and connects the first's right side to the second's left side.
  await a.keyboard.press("r")
  await drag(a, { x: 300, y: 200 }, { x: 400, y: 280 })
  await a.keyboard.press("r")
  await drag(a, { x: 600, y: 200 }, { x: 700, y: 280 })
  await a.keyboard.press("c")
  await drag(a, { x: 395, y: 245 }, { x: 605, y: 235 })
  const [first, second] = await elements(a)
  await expect
    .poll(async () => {
      const c = await connector(b)
      return [c?.start?.elementId, c?.start?.anchor, c?.end?.elementId, c?.end?.anchor, c?.style]
    })
    .toEqual([first?.id, "right", second?.id, "left", "elbow"])

  // B moves the second rectangle down; A's connector now bends down to it, so clicking the
  // new vertical leg (halfway across) selects it.
  await drag(b, { x: 650, y: 240 }, { x: 650, y: 440 })
  await expect
    .poll(async () => (await connector(a))?.end?.fallback)
    .toEqual({ x: second?.x ?? 0, y: (second?.y ?? 0) + 240 })
  const canvas = await a.getByLabel("Board canvas").boundingBox()
  await a.mouse.click((canvas?.x ?? 0) + 500, (canvas?.y ?? 0) + 340)
  await expect(a.getByRole("button", { name: "Elbow" })).toHaveAttribute("aria-pressed", "true")

  // A switches it to straight; B sees the style.
  await a.getByRole("button", { name: "Straight" }).click()
  await expect.poll(async () => (await connector(b))?.style).toBe("straight")

  // B deletes the second rectangle: the connector stays, its end where the shape was.
  await b.keyboard.press("Escape")
  await b.mouse.click(
    ((await b.getByLabel("Board canvas").boundingBox())?.x ?? 0) + 650,
    ((await b.getByLabel("Board canvas").boundingBox())?.y ?? 0) + 440,
  )
  await b.keyboard.press("Delete")
  await expect.poll(async () => (await elements(a)).length).toBe(1)
  expect((await connector(a))?.end?.fallback).toEqual({
    x: second?.x ?? 0,
    y: (second?.y ?? 0) + 240,
  })

  await contextA.close()
  await contextB.close()
})
