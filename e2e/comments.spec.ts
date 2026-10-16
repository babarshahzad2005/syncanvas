import { expect, test } from "@playwright/test"
import {
  addComment as comment,
  drag,
  enableTestHooks,
  invite,
  pinOf as pin,
  signIn,
  waitUntilOnline,
} from "./helpers"

// M4 ticket 01: Threads pinned to an Element or a point, live in the other browser, with
// replies; pins follow their Element; Viewers read without a reply box.

test("Threads appear live, take replies, and follow their Element", async ({ browser }) => {
  test.setTimeout(180_000)
  const stamp = Date.now()
  const graceEmail = `e2e-grace-${stamp}@example.com`
  const linusEmail = `e2e-linus-${stamp}@example.com`

  const grace = await (await browser.newContext()).newPage()
  await signIn(grace, graceEmail, { name: "Grace Hopper" })
  const linus = await (await browser.newContext()).newPage()
  await signIn(linus, linusEmail, { name: "Linus Viewer" })

  const ada = await (await browser.newContext()).newPage()
  await enableTestHooks(ada)
  await signIn(ada, `e2e-ada-${stamp}@example.com`, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)
  await invite(ada, graceEmail, "editor")
  await invite(ada, linusEmail, "viewer")

  // A rectangle to comment on.
  await ada.keyboard.press("r")
  await drag(ada, { x: 300, y: 200 }, { x: 460, y: 320 })

  await grace.goto(ada.url())
  await waitUntilOnline(grace)

  // Ada pins one Thread on the rectangle and one on empty canvas.
  await comment(ada, { x: 400, y: 260 }, "Move this?")
  await comment(ada, { x: 760, y: 520 }, "Over here")
  await expect(pin(ada, "Move this\\?")).toBeVisible()

  // Grace sees both pins live, opens one, and replies.
  await expect(pin(grace, "Move this\\?")).toBeVisible()
  await expect(pin(grace, "Over here")).toBeVisible()
  await pin(grace, "Move this\\?").click()
  const card = grace.getByRole("region", { name: "Comment thread" })
  await expect(card).toContainText("Ada Lovelace")
  await expect(card).toContainText("Move this?")
  await card.getByRole("textbox", { name: "Reply" }).fill("Sure, where to?")
  await card.getByRole("textbox", { name: "Reply" }).press("Enter")
  await expect(card).toContainText("Sure, where to?")
  await expect(card.getByRole("textbox", { name: "Reply" })).toHaveValue("")

  // Ada's pin now counts two comments, and her card shows the reply.
  await expect(pin(ada, "Move this\\?")).toHaveText("2")
  await pin(ada, "Move this\\?").click()
  await expect(ada.getByRole("region", { name: "Comment thread" })).toContainText("Sure, where to?")
  await ada.keyboard.press("Escape")

  // Moving the rectangle moves its pin in the other browser; the canvas pin stays put.
  const before = await pin(grace, "Move this\\?").boundingBox()
  const still = await pin(grace, "Over here").boundingBox()
  await ada.keyboard.press("v")
  await drag(ada, { x: 330, y: 230 }, { x: 430, y: 330 })
  await expect
    .poll(async () => Math.round((await pin(grace, "Move this\\?").boundingBox())?.x ?? 0))
    .toBe(Math.round((before?.x ?? 0) + 100))
  expect((await pin(grace, "Over here").boundingBox())?.x).toBe(still?.x)

  // A Viewer reads the Thread, but has no reply box and no comment tool.
  await linus.goto(ada.url())
  await waitUntilOnline(linus)
  await pin(linus, "Move this\\?").click()
  const theirs = linus.getByRole("region", { name: "Comment thread" })
  await expect(theirs).toContainText("Sure, where to?")
  await expect(theirs.getByRole("textbox", { name: "Reply" })).toBeHidden()
  await expect(linus.getByRole("toolbar", { name: "Tools" }).getByLabel("Comment")).toBeDisabled()

  for (const page of [ada, grace, linus]) await page.context().close()
})
