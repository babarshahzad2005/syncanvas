import { expect, type Page, test } from "@playwright/test"
import { drag, enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M1 ticket 05: free arrows sync live, and moving one moves both ends.

/** Each arrow's ends in world coordinates, rounded. */
async function arrows(page: Page) {
  return page.evaluate(
    () =>
      window.__syncanvas?.elements().flatMap((e) =>
        e.type === "arrow" && e.position && e.ends
          ? [
              {
                color: e.color,
                from: [
                  Math.round(e.position.x + e.ends.from.x),
                  Math.round(e.position.y + e.ends.from.y),
                ],
                to: [
                  Math.round(e.position.x + e.ends.to.x),
                  Math.round(e.position.y + e.ends.to.y),
                ],
              },
            ]
          : [],
      ) ?? [],
  )
}

test("an arrow drawn in one browser appears and moves in the other", async ({ browser }) => {
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

  // A draws an arrow right-to-left and up; the head is where the drag ended.
  await a.keyboard.press("a")
  await drag(a, { x: 700, y: 450 }, { x: 500, y: 300 })
  await expect(a.getByRole("button", { name: "Select" })).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => arrows(b)).toHaveLength(1)
  const [drawn] = await arrows(b)
  expect(drawn).toMatchObject({ color: "ink" })
  expect((drawn?.from[0] ?? 0) - (drawn?.to[0] ?? 0)).toBe(200)
  expect((drawn?.from[1] ?? 0) - (drawn?.to[1] ?? 0)).toBe(150)

  // A recolors it from the tray (it's selected after drawing).
  await a.getByRole("button", { name: "Color violet" }).click()
  await expect.poll(async () => (await arrows(b))[0]?.color).toBe("violet")

  // B grabs it by the middle of the line and moves it; both ends move in A.
  await drag(b, { x: 600, y: 375 }, { x: 640, y: 415 })
  await expect
    .poll(async () => (await arrows(a))[0])
    .toMatchObject({
      from: [(drawn?.from[0] ?? 0) + 40, (drawn?.from[1] ?? 0) + 40],
      to: [(drawn?.to[0] ?? 0) + 40, (drawn?.to[1] ?? 0) + 40],
    })

  await contextA.close()
  await contextB.close()
})
