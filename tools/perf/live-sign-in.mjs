// Signs a person in to the live site once, in a visible Edge window, and saves that browser
// session for `pnpm perf` / `pnpm loadtest` against production (M6 ticket 08d). The live site
// sends real sign-in emails, so a person has to open their link in this window. Never print
// or commit the saved file; delete it when the measuring is done.
//
//   node tools/perf/live-sign-in.mjs <path to save the session>

import { chromium } from "@playwright/test"

const LIVE = process.env.PERF_BASE ?? "https://syncanvas.babarshahzad2005.workers.dev"
const out = process.argv[2]
if (!out) throw new Error("Usage: node tools/perf/live-sign-in.mjs <path to save the session>")

const browser = await chromium.launch({ channel: "msedge", headless: false })
const context = await browser.newContext({ viewport: { width: 1200, height: 800 } })
const page = await context.newPage()
await page.goto(`${LIVE}/sign-in`)
console.log("Waiting for you to sign in in the Edge window (up to 15 minutes)…")

const deadline = Date.now() + 15 * 60_000
let signedIn = false
while (Date.now() < deadline) {
  const res = await context.request.get(`${LIVE}/api/auth/get-session`).catch(() => null)
  const body = res?.ok() ? await res.json().catch(() => null) : null
  if (body?.user) {
    signedIn = true
    break
  }
  await new Promise((r) => setTimeout(r, 2000))
}
if (signedIn) {
  await context.storageState({ path: out })
  console.log("Signed in. Session saved.")
} else {
  console.log("Gave up waiting: not signed in.")
}
await browser.close()
process.exit(signedIn ? 0 : 1)
