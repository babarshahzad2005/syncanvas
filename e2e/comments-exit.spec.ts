import { expect, test } from "@playwright/test"
import {
  clickCanvas,
  drag,
  enableTestHooks,
  invite,
  pinOf,
  signIn,
  waitUntilOnline,
} from "./helpers"

// M4 exit check (PRD §8) and ticket 03: a Commenter pins a Thread to an Element and mentions
// the Owner, who sees the pin and the Notification live and opens it onto the card; the pin
// follows the Element, detaches when it's deleted, and reattaches on undo; a Viewer's
// comment write is refused.

test("M4 exit check: a Mention reaches the Owner, and the pin follows its Element", async ({
  browser,
}) => {
  test.setTimeout(240_000)
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
  const boardUrl = ada.url()
  const boardId = new URL(boardUrl).pathname.split("/").at(-1) ?? ""
  await invite(ada, graceEmail, "commenter")
  await invite(ada, linusEmail, "viewer")
  await ada.keyboard.press("r")
  await drag(ada, { x: 300, y: 200 }, { x: 460, y: 320 })
  await ada.keyboard.press("Escape")

  // Grace, a Commenter, pins a Thread on the rectangle and mentions Ada from the picker.
  await grace.goto(boardUrl)
  await waitUntilOnline(grace)
  await grace.keyboard.press("m")
  await clickCanvas(grace, { x: 400, y: 260 })
  const box = grace.getByRole("region", { name: "New comment" }).getByRole("textbox", {
    name: "Comment",
  })
  await box.pressSequentially("Can you check this @Ad")
  const picker = grace.getByRole("listbox", { name: "Mention someone" })
  await expect(picker.getByRole("option")).toHaveCount(1)
  await expect(picker).toContainText("Ada Lovelace")
  await box.press("Enter") // picks
  await expect(box).toHaveValue("Can you check this @Ada Lovelace ")
  await box.pressSequentially("please")
  await box.press("Enter") // sends
  const graceCard = grace.getByRole("region", { name: "Comment thread" })
  await expect(graceCard).toContainText("Can you check this @Ada Lovelace please")
  await grace.keyboard.press("Escape")

  // Ada sees the pin and the bell live.
  await expect(pinOf(ada, "Can you check this")).toBeVisible()
  await expect(ada.getByRole("button", { name: "Notifications (1 unread)" })).toBeVisible()

  // From the dashboard, the Notification opens the Board on that Thread.
  await ada.goto("/")
  await ada.getByRole("button", { name: "Notifications (1 unread)" }).click()
  await ada.getByRole("button", { name: /Grace Hopper mentioned you/ }).click()
  await ada.waitForURL(boardUrl)
  await waitUntilOnline(ada)
  const adaCard = ada.getByRole("region", { name: "Comment thread" })
  await expect(adaCard).toContainText("Can you check this @Ada Lovelace please")
  await expect(ada.getByRole("button", { name: "Notifications" })).toBeVisible() // read now
  await ada.keyboard.press("Escape")

  // The pin follows the rectangle (found by its pin, since opening the Thread moved Ada's view).
  const pinBox = async () => {
    const b = await pinOf(ada, "Can you check this").boundingBox()
    if (!b) throw new Error("no pin")
    return { x: b.x - 15, y: b.y + b.height + 15 }
  }
  const before = await pinOf(grace, "Can you check this").boundingBox()
  const grab = await pinBox()
  await ada.mouse.move(grab.x, grab.y)
  await ada.mouse.down()
  await ada.mouse.move(grab.x + 100, grab.y, { steps: 8 })
  await ada.mouse.up()
  await expect
    .poll(async () => Math.round((await pinOf(grace, "Can you check this").boundingBox())?.x ?? 0))
    .toBe(Math.round((before?.x ?? 0) + 100))

  // It detaches when the rectangle is deleted, and reattaches on undo.
  const at = await pinBox()
  await ada.mouse.click(at.x, at.y)
  await ada.keyboard.press("Delete")
  await expect(pinOf(grace, "Can you check this.* \\(detached\\)")).toBeVisible()
  await ada.keyboard.press("Control+z")
  await expect(pinOf(grace, "Can you check this[^(]*$")).toBeVisible()

  // A Viewer is refused every comment write.
  await linus.goto(boardUrl)
  await waitUntilOnline(linus)
  const write = await linus.request.post(`/api/boards/${boardId}/threads`, {
    data: { anchor: { x: 0, y: 0 }, body: "Sneaky" },
  })
  expect(write.status()).toBe(403)

  for (const page of [ada, grace, linus]) await page.context().close()
})
