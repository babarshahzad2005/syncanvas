import { expect, type Page, test } from "@playwright/test"
import { enableTestHooks, invite, signIn, waitUntilOnline } from "./helpers"

// M5b exit check (PRD §8; ticket 07): an Editor drops a PNG and a Collaborator sees it, while a
// Viewer can't upload; search finds the Board by a sticky note's text, and a stranger's search
// doesn't; an Editor previews an older Version and restores it, undo reverts it, and a Viewer
// never sees Version history; 500+ edits compact and reload identical.

const elements = (page: Page) => page.evaluate(() => window.__syncanvas?.elements() ?? [])
const types = async (page: Page) => (await elements(page)).map((e) => e.type).sort()
const boardIdOf = (page: Page) => new URL(page.url()).pathname.split("/").at(-1) ?? ""

/** Drops a 300×150 PNG drawn in the page onto the canvas at (x, y) in canvas px. */
async function dropPng(page: Page, x: number, y: number) {
  const box = await page.getByLabel("Board canvas").boundingBox()
  const dataTransfer = await page.evaluateHandle(async () => {
    const canvas = new OffscreenCanvas(300, 150)
    const g = canvas.getContext("2d")
    if (g) {
      g.fillStyle = "#2e7d32"
      g.fillRect(0, 0, 300, 150)
    }
    const dt = new DataTransfer()
    const blob = await canvas.convertToBlob({ type: "image/png" })
    dt.items.add(new File([blob], "green.png", { type: "image/png" }))
    return dt
  })
  const at = { clientX: (box?.x ?? 0) + x, clientY: (box?.y ?? 0) + y }
  await page.getByLabel("Board canvas").dispatchEvent("dragover", { dataTransfer, ...at })
  await page.getByLabel("Board canvas").dispatchEvent("drop", { dataTransfer, ...at })
}

test("M5b exit check", async ({ browser }) => {
  test.setTimeout(600_000)
  const stamp = Date.now()
  const word = `quokka${stamp.toString(36).replace(/\d/g, "")}`
  const graceEmail = `e2e-m5b-grace-${stamp}@example.com`
  const linEmail = `e2e-m5b-lin-${stamp}@example.com`

  // Ada (Owner), Grace (Editor), and Lin (Viewer) on one Board.
  const contextA = await browser.newContext()
  const ada = await contextA.newPage()
  await enableTestHooks(ada)
  await signIn(ada, `e2e-m5b-ada-${stamp}@example.com`, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)
  const boardId = boardIdOf(ada)
  const people: Page[] = []
  for (const [email, name, role] of [
    [graceEmail, "Grace Hopper", "editor"],
    [linEmail, "Lin Wei", "viewer"],
  ] as const) {
    const page = await (await browser.newContext()).newPage()
    await enableTestHooks(page)
    await signIn(page, email, { name })
    await invite(ada, email, role)
    await page.goto(ada.url())
    await waitUntilOnline(page)
    people.push(page)
  }
  const [grace, lin] = people as [Page, Page]

  // 1. Images: Ada drops a PNG and Grace sees it; Lin has no way to add one.
  await dropPng(ada, 400, 300)
  await expect.poll(() => types(grace)).toEqual(["image"])
  const key = (await elements(grace))[0]?.key ?? ""
  await expect.poll(() => grace.evaluate((k) => window.__syncanvas?.image(k), key)).toBe("ready")
  await expect(lin.getByRole("button", { name: "Image", exact: true })).toBeDisabled()

  // 2. Search: a word on a sticky note finds the Board once it's indexed; not for a stranger.
  await ada.keyboard.press("s")
  await ada.mouse.click(900, 450)
  await ada.keyboard.type(`Ship the ${word} release`)
  await ada.keyboard.press("Escape")
  await expect.poll(() => types(grace)).toEqual(["image", "sticky"])
  await expect
    .poll(async () => (await ada.request.post(`/api/dev/compact/${boardId}`)).ok())
    .toBe(true)
  const dashboard = await contextA.newPage()
  await dashboard.goto("/")
  await dashboard.getByRole("combobox", { name: "Search boards" }).fill(word)
  await expect(dashboard.getByRole("option")).toHaveCount(1)
  await expect(dashboard.getByRole("option").locator("strong")).toHaveText(word)
  await dashboard.close()
  const stranger = await (await browser.newContext()).newPage()
  await signIn(stranger, `e2e-m5b-sam-${stamp}@example.com`)
  await stranger.getByRole("combobox", { name: "Search boards" }).fill(word)
  await expect(stranger.getByText(`No boards match “${word}”.`)).toBeVisible()
  await stranger.context().close()

  // 3. Versions: that compaction kept a Version with the note. Ada deletes the note, previews
  // the Version, restores it, and undoes the restore.
  await ada.mouse.click(900, 450)
  await ada.keyboard.press("Delete")
  await expect.poll(() => types(grace)).toEqual(["image"])
  await ada.getByRole("button", { name: "Board menu" }).click()
  await ada.getByRole("menuitem", { name: "Version history…" }).click()
  const panel = ada.getByRole("complementary", { name: "Version history" })
  const today = panel.getByRole("region", { name: "Today" })
  await expect(today.getByRole("button")).toHaveCount(1)
  await today.getByRole("button").click()
  await expect(ada.getByText(/^Viewing /)).toBeVisible()
  await expect
    .poll(() =>
      ada.evaluate(() => (window.__syncanvasPreview?.elements() ?? []).map((e) => e.type).sort()),
    )
    .toEqual(["image", "sticky"])
  // The live Board hasn't changed underneath.
  expect(await types(grace)).toEqual(["image"])
  await ada.getByRole("button", { name: "Restore" }).click()
  await expect(ada.getByText(/^Restored the version from /)).toBeVisible()
  await expect(panel).toBeHidden()
  await expect.poll(() => types(grace)).toEqual(["image", "sticky"])
  await expect
    .poll(async () => (await elements(grace)).find((e) => e.type === "sticky")?.text)
    .toBe(`Ship the ${word} release`)
  await ada.keyboard.press("Control+z")
  await expect.poll(() => types(grace)).toEqual(["image"])

  // A Viewer never sees history: no menu item, and the API refuses.
  await lin.getByRole("button", { name: "Board menu" }).click()
  await expect(lin.getByRole("menuitem", { name: "Rename…" })).toBeVisible()
  await expect(lin.getByRole("menuitem", { name: "Version history…" })).toHaveCount(0)
  await lin.keyboard.press("Escape")
  expect((await lin.request.get(`/api/boards/${boardId}/versions`)).status()).toBe(403)

  // 4. Compaction: 520 nudges of the image, compacted, and a fresh browser loads it identical.
  await ada.mouse.click(400, 300)
  const imageX = async () => (await elements(ada)).find((e) => e.type === "image")?.position?.x
  const start = (await imageX()) ?? 0
  for (let i = 0; i < 520; i++) await ada.keyboard.press("ArrowRight")
  await expect.poll(imageX).toBe(start + 520)
  await ada.waitForTimeout(1_000)
  const compacted = await ada.request.post(`/api/dev/compact/${boardId}`)
  expect(await compacted.json()).toEqual({ pending: 0 })
  const snapshot = async (page: Page) =>
    (await elements(page)).map((e) => JSON.stringify([e.id, e.type, e.position, e.size])).sort()
  const before = await snapshot(ada)
  const fresh = await (
    await browser.newContext({ storageState: await contextA.storageState() })
  ).newPage()
  await enableTestHooks(fresh)
  await fresh.goto(`/b/${boardId}`)
  await waitUntilOnline(fresh)
  await expect.poll(() => snapshot(fresh)).toEqual(before)

  // The browsers close with the worker: closing five contexts here could hang past the timeout.
})
