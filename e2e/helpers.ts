import { expect, type Page } from "@playwright/test"

/** Exposes the Board's Elements to tests (see board-canvas.tsx). */
export async function enableTestHooks(page: Page) {
  await page.addInitScript(() => {
    window.__SYNCANVAS_TEST__ = true
  })
}

/** Signs in through the real UI, reading the magic link from the dev-only inbox. */
export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in")
  await page.getByLabel("Email").fill(email)
  await page.getByRole("button", { name: "Continue with email" }).click()
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible()
  let link = ""
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/dev/magic-link?email=${encodeURIComponent(email)}`)
      if (res.ok()) link = ((await res.json()) as { url: string }).url
      return link
    })
    .not.toBe("")
  await page.goto(link)
  await page.waitForURL("/")
}

export type Shape = {
  id: string
  type: string
  x: number
  y: number
  w: number
  h: number
  color: string
  fill?: string
  points?: number[][]
}

/** Elements with a box, rounded to whole pixels. */
export async function elements(page: Page): Promise<Shape[]> {
  return page.evaluate(
    () =>
      window.__syncanvas?.elements().flatMap((e) =>
        e.position && e.size
          ? [
              {
                id: e.id,
                type: e.type,
                x: Math.round(e.position.x),
                y: Math.round(e.position.y),
                w: Math.round(e.size.w),
                h: Math.round(e.size.h),
                color: e.color,
                fill: e.fill,
                points: e.points,
              },
            ]
          : [],
      ) ?? [],
  )
}

export async function waitUntilOnline(page: Page) {
  const pill = page.getByRole("link", { name: "Back to your boards" })
  await expect(pill).not.toContainText("Loading")
  await expect(pill).not.toContainText("Connecting")
  await expect(pill).not.toContainText("Offline")
}

/** Canvas-relative drag with intermediate moves, like a real pointer. */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const box = await page.getByLabel("Board canvas").boundingBox()
  if (!box) throw new Error("canvas not visible")
  await page.mouse.move(box.x + from.x, box.y + from.y)
  await page.mouse.down()
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 })
  await page.mouse.up()
}
