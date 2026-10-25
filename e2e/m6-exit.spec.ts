import { expect, type Page, test } from "@playwright/test"
import { drag, elements, enableTestHooks, shareLinkOf, signIn, waitUntilOnline } from "./helpers"

// M6 exit check (ticket 09): exports download as real PNG, SVG, and PDF files; an Embed framed
// by another site shows edits live and goes away when it's turned off; and a Guest turned away
// by a full Board sees its last picture.

/** Exports the whole Board in `format` and returns the downloaded file's name and bytes. */
async function exportAs(page: Page, format: "PNG" | "SVG" | "PDF") {
  await page.getByRole("button", { name: "Board menu" }).click()
  await page.getByRole("menuitem", { name: "Export…" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: format, exact: true }).click()
  const download = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "Export", exact: true }).click()
  const file = await download
  const path = await file.path()
  const { readFileSync } = await import("node:fs")
  return { name: file.suggestedFilename(), bytes: readFileSync(path) }
}

test("export, Embed, and the busy picture work end to end", async ({ browser }) => {
  test.setTimeout(240_000)
  const stamp = Date.now()
  const ada = await (await browser.newContext()).newPage()
  await enableTestHooks(ada)
  await signIn(ada, `e2e-ada-${stamp}@example.com`, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)
  const boardId = new URL(ada.url()).pathname.split("/").at(-1) ?? ""
  await ada.keyboard.press("r")
  await drag(ada, { x: 300, y: 300 }, { x: 460, y: 400 })
  await ada.keyboard.press("Escape")

  // Exports: each file is non-empty and really of its type.
  const png = await exportAs(ada, "PNG")
  expect(png.name).toMatch(/\.png$/)
  expect(png.bytes.subarray(0, 8).toString("latin1")).toBe("\x89PNG\r\n\x1a\n")
  const svg = await exportAs(ada, "SVG")
  expect(svg.name).toMatch(/\.svg$/)
  expect(svg.bytes.toString("utf8")).toContain("<svg")
  const pdf = await exportAs(ada, "PDF")
  expect(pdf.name).toMatch(/\.pdf$/)
  expect(pdf.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-")

  // The Owner turns on the Embed and takes its snippet.
  await ada.getByRole("button", { name: "Share" }).click()
  const share = ada.getByRole("dialog")
  await share.getByRole("switch", { name: "Embed" }).click()
  const snippet = await share.getByLabel("Embed snippet").inputValue()
  const src = /src="([^"]+)"/.exec(snippet)?.[1]
  if (!src) throw new Error(`no src in the snippet: ${snippet}`)

  // Another site frames it. [::1] is another origin than localhost, and still local, so the
  // browser allows the frame (see ticket 06's notes).
  const site = await (await browser.newContext()).newPage()
  await enableTestHooks(site)
  await site.goto("http://[::1]:5173/api/health")
  await site.evaluate((url) => {
    document.body.innerHTML = `<iframe src="${url}" width="800" height="500"></iframe>`
  }, src)
  const embed = () => site.frames().find((f) => f.url().includes("/embed/"))
  const embedState = () =>
    embed()?.evaluate(() => ({
      status: window.__syncanvasEmbed?.status(),
      count: window.__syncanvasEmbed?.elements().length ?? 0,
    })) ?? Promise.resolve(null)
  await expect.poll(embedState, { timeout: 30_000 }).toEqual({ status: "online", count: 1 })

  // An edit shows up live in the frame.
  await ada.keyboard.press("Escape")
  await expect(share).toBeHidden()
  await ada.keyboard.press("r")
  await drag(ada, { x: 600, y: 300 }, { x: 700, y: 380 })
  await ada.keyboard.press("Escape")
  await expect.poll(() => elements(ada).then((e) => e.length)).toBe(2)
  await expect.poll(embedState, { timeout: 15_000 }).toEqual({ status: "online", count: 2 })

  // Turned off: the frame says so.
  await ada.getByRole("button", { name: "Share" }).click()
  await ada.getByRole("dialog").getByRole("switch", { name: "Embed" }).click()
  await ada.getByRole("dialog").press("Escape")
  await expect
    .poll(() => embed()?.locator("body").innerText() ?? Promise.resolve(""), { timeout: 15_000 })
    .toContain("This embed is no longer available.")

  // Leaving through the app saves the Board's picture (M5a ticket 05).
  const link = await shareLinkOf(ada, "viewer")
  const uploaded = ada.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith("/thumbnail"),
  )
  await ada.getByRole("link", { name: "Back to your boards" }).click()
  expect((await uploaded).ok()).toBe(true)

  // A full Board: one place, which Ada takes again. A Guest is turned away and sees the picture.
  const capped = await ada.request.post(`/api/dev/cap/${boardId}`, { data: { cap: 1 } })
  expect(capped.ok()).toBe(true)
  await ada.goto(`/b/${boardId}`)
  await waitUntilOnline(ada)
  const guest = await (await browser.newContext()).newPage()
  await guest.goto(link)
  await expect(guest.getByRole("heading", { name: "This board is busy right now" })).toBeVisible({
    timeout: 30_000,
  })
  const picture = guest.getByRole("img", { name: "The board, as it was last saved" })
  await expect(picture).toBeVisible({ timeout: 15_000 })
  expect(await picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)

  await ada.request.post(`/api/dev/cap/${boardId}`, { data: { cap: null } })
})
