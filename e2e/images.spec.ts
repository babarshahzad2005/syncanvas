import { expect, type Page, test } from "@playwright/test"
import { enableTestHooks, invite, shareLinkOf, signIn, waitUntilOnline } from "./helpers"

// M5b ticket 03: an Editor drops a PNG and a Collaborator sees it; a Guest (a Viewer) sees it
// too but can't add one; a file over 5 MB is refused with the API's words.

async function all(page: Page) {
  return page.evaluate(() => window.__syncanvas?.elements() ?? [])
}

/** Drops a 300×150 PNG drawn in the page onto the canvas at (x, y) in canvas px. */
async function dropPng(page: Page, x: number, y: number) {
  const box = await page.getByLabel("Board canvas").boundingBox()
  const dataTransfer = await page.evaluateHandle(async () => {
    const canvas = new OffscreenCanvas(300, 150)
    const g = canvas.getContext("2d")
    if (g) {
      g.fillStyle = "#c62828"
      g.fillRect(0, 0, 300, 150)
    }
    const blob = await canvas.convertToBlob({ type: "image/png" })
    const dt = new DataTransfer()
    dt.items.add(new File([blob], "red.png", { type: "image/png" }))
    return dt
  })
  const at = { clientX: (box?.x ?? 0) + x, clientY: (box?.y ?? 0) + y }
  await page.getByLabel("Board canvas").dispatchEvent("dragover", { dataTransfer, ...at })
  await page.getByLabel("Board canvas").dispatchEvent("drop", { dataTransfer, ...at })
}

test("an Editor drops an image that others see, a Guest can't add one, and big files are refused", async ({
  browser,
}) => {
  const stamp = Date.now()
  const graceEmail = `e2e-grace-${stamp}@example.com`
  const contextA = await browser.newContext()
  const ada = await contextA.newPage()
  await enableTestHooks(ada)
  await signIn(ada, `e2e-ada-${stamp}@example.com`, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)

  const contextG = await browser.newContext()
  const grace = await contextG.newPage()
  await enableTestHooks(grace)
  await signIn(grace, graceEmail, { name: "Grace Hopper" })
  await invite(ada, graceEmail, "editor")
  await grace.goto(ada.url())
  await waitUntilOnline(grace)

  // A Guest through a view-only Share Link: no session, so images come with a board token.
  const link = await shareLinkOf(ada, "viewer")
  const contextV = await browser.newContext()
  const guest = await contextV.newPage()
  await enableTestHooks(guest)
  await guest.goto(link)
  await waitUntilOnline(guest)

  // Ada drops a PNG: it arrives fitted (300 px wide, under 480) and centered on the drop point.
  await dropPng(ada, 640, 400)
  await expect.poll(async () => (await all(grace)).filter((e) => e.type === "image").length).toBe(1)
  const [image] = (await all(grace)).filter((e) => e.type === "image")
  expect(image?.natural).toEqual({ w: 300, h: 150 })
  expect(image?.size).toEqual({ w: 300, h: 150 })
  const key = image?.key ?? ""
  expect(key).toMatch(/^images\//)
  // Grace (session) and the Guest (board token) both load the file.
  await expect.poll(() => grace.evaluate((k) => window.__syncanvas?.image(k), key)).toBe("ready")
  await expect.poll(() => guest.evaluate((k) => window.__syncanvas?.image(k), key)).toBe("ready")

  // The Guest has no Image button, and pasting an image file adds nothing.
  await expect(guest.getByRole("button", { name: "Image", exact: true })).toBeDisabled()
  await guest.evaluate(async () => {
    const canvas = new OffscreenCanvas(10, 10)
    canvas.getContext("2d")?.fillRect(0, 0, 10, 10)
    const blob = await canvas.convertToBlob({ type: "image/png" })
    const data = new DataTransfer()
    data.items.add(new File([blob], "x.png", { type: "image/png" }))
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data }))
  })
  await expect(guest.getByText("This Board is view-only")).toBeVisible()
  expect((await all(ada)).length).toBe(1)

  // Ada picks a 6 MB "PNG" with the dock's Image button: refused before uploading.
  const chooser = ada.waitForEvent("filechooser")
  await ada.getByRole("button", { name: "Image", exact: true }).click()
  await (await chooser).setFiles({
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(6 * 1024 * 1024),
  })
  await expect(ada.getByText("Images can be up to 5 MB.")).toBeVisible()
  expect((await all(ada)).length).toBe(1)

  await contextA.close()
  await contextG.close()
  await contextV.close()
})
