import { expect, test } from "@playwright/test"
import { drag, enableTestHooks, signIn, waitUntilOnline } from "./helpers"

// M1 ticket 14: every tool key, the "?" sheet, and a style tray showing only what the whole
// selection shares.

test("tool keys, the shortcut sheet, and the tray for mixed selections", async ({ page }) => {
  await enableTestHooks(page)
  await signIn(page, `e2e-${Date.now()}@example.com`)
  await page.getByRole("button", { name: "Blank board" }).click()
  await page.waitForURL(/\/b\//)
  await waitUntilOnline(page)
  const tools = page.getByRole("toolbar", { name: "Tools" })
  const tray = page.getByRole("toolbar", { name: "Style" })

  // Every tool key selects its tool; the image tool is visibly unavailable.
  for (const [key, name] of [
    ["p", "Pen"],
    ["r", "Rectangle"],
    ["o", "Ellipse"],
    ["a", "Arrow"],
    ["c", "Connector"],
    ["t", "Text"],
    ["s", "Sticky note"],
    ["v", "Select"],
  ] as const) {
    await page.keyboard.press(key)
    await expect(tools.getByRole("button", { name, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  }
  await expect(tools.getByRole("button", { name: "Image" })).toBeDisabled()

  // "?" opens the sheet; Escape closes it.
  await page.keyboard.press("?")
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" })
  await expect(sheet).toBeVisible()
  for (const group of ["Tools", "Selection", "Editing", "Navigation"]) {
    await expect(sheet.getByRole("region", { name: group })).toBeVisible()
  }
  await page.keyboard.press("Escape")
  await expect(sheet).toBeHidden()

  // A rectangle (light fill) and an ellipse made solid: the shared fill group shows, with
  // nothing pressed because the fills differ.
  await page.keyboard.press("r")
  await drag(page, { x: 300, y: 200 }, { x: 380, y: 260 })
  await page.keyboard.press("o")
  await drag(page, { x: 420, y: 200 }, { x: 500, y: 260 })
  await tray.getByRole("button", { name: "Solid fill" }).click()
  await drag(page, { x: 250, y: 150 }, { x: 550, y: 300 })
  await expect(tray.getByRole("button", { name: "Light fill" })).toHaveAttribute(
    "aria-pressed",
    "false",
  )
  await expect(tray.getByRole("button", { name: "Solid fill" })).toHaveAttribute(
    "aria-pressed",
    "false",
  )
  await expect(tray.getByRole("button", { name: "Color ink" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )

  // Add a pen stroke: fill isn't shared any more, color still is.
  await page.keyboard.press("Escape")
  await page.keyboard.press("p")
  await drag(page, { x: 300, y: 350 }, { x: 450, y: 380 })
  await page.keyboard.press("v")
  await drag(page, { x: 250, y: 150 }, { x: 550, y: 420 })
  await expect(tray.getByRole("button", { name: "Solid fill" })).toHaveCount(0)
  await expect(tray.getByRole("button", { name: "Thin" })).toHaveCount(0)
  await expect(tray.getByRole("button", { name: "Color red" })).toBeVisible()

  // A text and a sticky share size S/M/L and bold, but not colors, XL, or alignment.
  await page.keyboard.press("Escape")
  await page.keyboard.press("t")
  await page.mouse.click(
    ((await page.getByLabel("Board canvas").boundingBox())?.x ?? 0) + 700,
    ((await page.getByLabel("Board canvas").boundingBox())?.y ?? 0) + 200,
  )
  await page.keyboard.type("Title")
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await page.keyboard.press("s")
  await page.mouse.click(
    ((await page.getByLabel("Board canvas").boundingBox())?.x ?? 0) + 800,
    ((await page.getByLabel("Board canvas").boundingBox())?.y ?? 0) + 400,
  )
  await page.keyboard.type("Note")
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await drag(page, { x: 650, y: 150 }, { x: 950, y: 560 })
  await expect(tray.getByRole("button", { name: "Size M" })).toHaveAttribute("aria-pressed", "true")
  await expect(tray.getByRole("button", { name: "Bold" })).toBeVisible()
  await expect(tray.getByRole("button", { name: "Size XL" })).toHaveCount(0)
  await expect(tray.getByRole("button", { name: "Align left" })).toHaveCount(0)
  await expect(tray.getByRole("button", { name: /^Color / })).toHaveCount(0)
})
