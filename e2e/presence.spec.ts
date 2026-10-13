import { expect, test } from "@playwright/test"
import { enableTestHooks, shareBoard, signIn, waitUntilOnline } from "./helpers"

// M2 ticket 02: the presence pill shows who else is on the Board, and updates when they leave.

test("two people see each other in the presence pill", async ({ browser }) => {
  const stamp = Date.now()
  const adaEmail = `e2e-ada-${stamp}@example.com`
  const graceEmail = `e2e-grace-${stamp}@example.com`

  const contextA = await browser.newContext()
  const ada = await contextA.newPage()
  await enableTestHooks(ada)
  await signIn(ada, adaEmail, { name: "Ada Lovelace" })
  await ada.getByRole("button", { name: "Blank board" }).click()
  await ada.waitForURL(/\/b\//)
  await waitUntilOnline(ada)

  const contextG = await browser.newContext()
  const grace = await contextG.newPage()
  await enableTestHooks(grace)
  await signIn(grace, graceEmail, { name: "Grace Hopper" })
  await shareBoard(ada.url(), graceEmail)

  // Alone on the Board, there's no pill.
  const pill = (page: typeof ada) => page.getByRole("region", { name: "People on this board" })
  await expect(pill(ada)).toBeHidden()

  // Grace opens it: each sees the other, by name.
  await grace.goto(ada.url())
  await waitUntilOnline(grace)
  await expect(pill(ada).getByRole("img", { name: "Grace Hopper" })).toBeVisible()
  await expect(pill(grace).getByRole("img", { name: "Ada Lovelace" })).toBeVisible()
  await expect(pill(ada)).toContainText("GH")

  // A second tab of Ada's doesn't make her two people, and isn't "someone else" for her.
  const adaAgain = await contextA.newPage()
  await adaAgain.goto(ada.url())
  await waitUntilOnline(adaAgain)
  await expect(pill(grace).getByRole("img")).toHaveCount(1)
  await expect(pill(adaAgain).getByRole("img", { name: "Grace Hopper" })).toBeVisible()
  await expect(pill(adaAgain).getByRole("img")).toHaveCount(1)

  // Grace leaves: she's gone from Ada's pill within 2 s, and the pill hides.
  await contextG.close()
  await expect(pill(ada)).toBeHidden({ timeout: 2_000 })

  await contextA.close()
})
