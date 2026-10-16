import { expect, test } from "@playwright/test"
import {
  addComment,
  drag,
  enableTestHooks,
  invite,
  pinOf,
  signIn,
  waitUntilOnline,
} from "./helpers"

// M4 ticket 02: edit and delete comments, resolve and reopen with "Show resolved", Detached
// Threads that reattach on undo, and the Owner deleting a Thread.

test("comments are edited, deleted, resolved, detached, and reattached", async ({ browser }) => {
  test.setTimeout(240_000)
  const stamp = Date.now()
  const graceEmail = `e2e-grace-${stamp}@example.com`

  const grace = await (await browser.newContext()).newPage()
  await signIn(grace, graceEmail, { name: "Grace Hopper" })

  const ada = await (await browser.newContext()).newPage()
  await enableTestHooks(ada)
  await signIn(ada, `e2e-ada-${stamp}@example.com`, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)
  await invite(ada, graceEmail, "commenter")

  await ada.keyboard.press("r")
  await drag(ada, { x: 300, y: 200 }, { x: 460, y: 320 })
  await addComment(ada, { x: 400, y: 260 }, "Fix the color")

  await grace.goto(ada.url())
  await waitUntilOnline(grace)

  // Grace replies, edits her reply, then deletes it.
  await pinOf(grace, "Fix the color").click()
  const card = grace.getByRole("region", { name: "Comment thread" })
  await card.getByRole("textbox", { name: "Reply" }).fill("On it")
  await card.getByRole("textbox", { name: "Reply" }).press("Enter")
  await expect(card).toContainText("On it")
  await card.getByRole("button", { name: "Actions for Grace Hopper's comment" }).click()
  await grace.getByRole("menuitem", { name: "Edit" }).click()
  await card.getByRole("textbox", { name: "Edit comment" }).fill("On it now")
  await card.getByRole("textbox", { name: "Edit comment" }).press("Enter")
  await expect(card).toContainText("On it now")
  await expect(card).toContainText("edited")
  // She can't edit or delete Ada's comment.
  await expect(
    card.getByRole("button", { name: "Actions for Ada Lovelace's comment" }),
  ).toHaveCount(0)
  await card.getByRole("button", { name: "Actions for Grace Hopper's comment" }).click()
  await grace.getByRole("menuitem", { name: "Delete" }).click()
  await expect(card).not.toContainText("On it now")

  // Resolving hides the pin for everyone; Show resolved brings it back.
  await card.getByRole("button", { name: "Resolve" }).click()
  await expect(card).toBeHidden()
  await expect(pinOf(ada, "Fix the color")).toHaveCount(0)
  await ada.getByRole("button", { name: "Comments (0 unresolved)" }).click()
  await ada.getByRole("switch", { name: "Show resolved" }).click()
  await expect(pinOf(ada, "Fix the color")).toBeVisible()
  await ada.getByRole("button", { name: /^Ada Lovelace.*resolved/ }).click()
  const adaCard = ada.getByRole("region", { name: "Comment thread" })
  await adaCard.getByRole("button", { name: "Reopen" }).click()
  await expect(pinOf(grace, "Fix the color")).toBeVisible()
  await ada.keyboard.press("Escape")

  // Deleting the rectangle detaches its pin, where the rectangle was; undo reattaches it.
  const attached = await pinOf(grace, "Fix the color").boundingBox()
  // Picking the Thread from the list panned Ada's view, so find the rectangle by its pin: the
  // pin's point (bottom-left corner) sits on it.
  async function deleteRectangle() {
    const box = await pinOf(ada, "Fix the color").boundingBox()
    if (!box) throw new Error("no pin")
    await ada.mouse.click(box.x - 15, box.y + box.height + 15)
    await ada.keyboard.press("Delete")
  }
  await deleteRectangle()
  await expect(pinOf(grace, "Fix the color \\(detached\\)")).toBeVisible()
  const detached = await pinOf(grace, "Fix the color").boundingBox()
  expect(detached).toEqual(attached)
  await ada.keyboard.press("Control+z")
  await expect(pinOf(grace, "Fix the color$")).toBeVisible()

  // A newcomer sees a detached pin too.
  await deleteRectangle()
  await grace.reload()
  await waitUntilOnline(grace)
  await expect(pinOf(grace, "Fix the color \\(detached\\)")).toBeVisible()

  // The Owner deletes the whole Thread, after confirming.
  await pinOf(ada, "Fix the color").click()
  await ada
    .getByRole("region", { name: "Comment thread" })
    .getByRole("button", {
      name: "Thread actions",
    })
    .click()
  await ada.getByRole("menuitem", { name: "Delete thread" }).click()
  await ada
    .getByRole("dialog", { name: "Delete this thread?" })
    .getByRole("button", {
      name: "Delete thread",
    })
    .click()
  await expect(pinOf(grace, "Fix the color")).toHaveCount(0)
  await expect(pinOf(ada, "Fix the color")).toHaveCount(0)

  for (const page of [ada, grace]) await page.context().close()
})
