import { expect, type Page } from "@playwright/test"

/** Exposes the Board's Elements to tests (see board-canvas.tsx). */
export async function enableTestHooks(page: Page) {
  await page.addInitScript(() => {
    window.__SYNCANVAS_TEST__ = true
  })
}

/**
 * Signs in through the real UI, reading the magic link from the dev-only inbox. The new User
 * gets a display name right away (pass `name: null` to keep them nameless), so the first-time
 * name dialog doesn't stand in the way of tests about something else.
 */
export async function signIn(
  page: Page,
  email: string,
  { name = "E2E Tester" } = {} as { name?: string | null },
) {
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
  if (name !== null) {
    const res = await page.request.post("/api/auth/update-user", {
      data: { name },
      headers: { origin: new URL(page.url()).origin }, // Better Auth checks the origin
    })
    expect(res.ok()).toBe(true)
  }
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

/**
 * Gives another signed-up User a Role on a Board, straight in the dev database: sharing
 * arrives in M3, and presence needs a second person before then.
 */
export async function shareBoard(boardUrl: string, email: string, role = "editor") {
  const { connectDb } = await import("./db")
  const sql = connectDb()
  if (!sql) throw new Error("no dev database configured")
  const boardId = new URL(boardUrl).pathname.split("/").at(-1)
  await sql`
    insert into memberships (board_id, user_id, role, via)
    select ${boardId}, id, ${role}, 'invitation' from "user" where email = ${email}
  `
  await sql.end()
}

/** Invites `email` to the Board open in `page`, through the real API, as that page's User. */
export async function invite(page: Page, email: string, role = "editor") {
  const boardId = new URL(page.url()).pathname.split("/").at(-1)
  const res = await page.request.post(`/api/boards/${boardId}/invitations`, {
    data: { email, role },
  })
  expect(res.status()).toBe(201)
}

/** Turns on the Share Link of the Board open in `page` and returns its address. */
export async function shareLinkOf(page: Page, role = "viewer") {
  const boardId = new URL(page.url()).pathname.split("/").at(-1) ?? ""
  const res = await page.request.put(`/api/boards/${boardId}/share-link`, { data: { role } })
  expect(res.ok()).toBe(true)
  const { token } = (await res.json()) as { token: string }
  return new URL(`/b/${boardId}?s=${encodeURIComponent(token)}`, page.url()).toString()
}

/** On the sign-in page: asks for a link for `email` and follows it from the dev inbox. */
export async function finishSignIn(page: Page, email: string) {
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
}

// ---------- Comments (M4) ----------

/** Clicks a canvas-relative point. */
export async function clickCanvas(page: Page, at: { x: number; y: number }) {
  const box = await page.getByLabel("Board canvas").boundingBox()
  await page.mouse.click((box?.x ?? 0) + at.x, (box?.y ?? 0) + at.y)
}

/** Places a comment with the comment tool (M) and closes its card. */
export async function addComment(page: Page, at: { x: number; y: number }, text: string) {
  await page.keyboard.press("m")
  await clickCanvas(page, at)
  const card = page.getByRole("region", { name: "New comment" })
  await card.getByRole("textbox", { name: "Comment" }).fill(text)
  await card.getByRole("textbox", { name: "Comment" }).press("Enter")
  await expect(card).toBeHidden()
  // The new Thread's card opens, ready for a reply; close it.
  await expect(page.getByRole("region", { name: "Comment thread" })).toContainText(text)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("region", { name: "Comment thread" })).toBeHidden()
}

/** A comment pin, found by its first comment's text (a regular expression source). */
export const pinOf = (page: Page, text: string) =>
  page.getByRole("button", { name: new RegExp(`^Comment by .*: ${text}`) })
