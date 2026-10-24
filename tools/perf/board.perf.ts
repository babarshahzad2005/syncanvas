import { appendFileSync } from "node:fs"
import { expect, type Page, test } from "@playwright/test"
import { enableTestHooks, signIn, waitUntilOnline } from "../../e2e/helpers"

// S5 and S6 (PRD success metrics; M6 ticket 08). Timings are taken against the production build
// served locally on :8787; signing in goes through the dev server on :5173 (same database, and
// cookies don't care about the port). Results print and append to $PERF_OUT if set.

const PROD = "http://localhost:8787"

function report(line: string) {
  console.log(line)
  if (process.env.PERF_OUT) appendFileSync(process.env.PERF_OUT, `${line}\n`)
}

/** `count` Elements in a grid: rectangles, sticky notes with text, text, and pen strokes. */
function board(count: number) {
  const elements: Record<string, unknown>[] = []
  const perRow = Math.ceil(Math.sqrt(count))
  const colors = ["ink", "red", "blue", "green", "violet", "orange"] as const
  const stickies = ["yellow", "pink", "blue", "green"] as const
  for (let i = 0; i < count; i++) {
    const position = { x: (i % perRow) * 140, y: Math.floor(i / perRow) * 140 }
    const kind = i % 10
    const base = { id: `p${i}`, z: "a0", position }
    if (kind < 4) {
      elements.push({
        ...base,
        type: "rect",
        color: colors[i % colors.length],
        fill: "light",
        size: { w: 110, h: 80 },
      })
    } else if (kind < 7) {
      elements.push({
        ...base,
        type: "sticky",
        color: stickies[i % stickies.length],
        text: `Idea ${i}: a short note`,
        fontSize: "M",
        bold: false,
        size: { w: 110, h: 110 },
      })
    } else if (kind < 9) {
      elements.push({
        ...base,
        type: "text",
        color: "ink",
        text: `Label ${i}`,
        fontSize: "M",
        bold: kind === 8,
        align: "left",
        autoWidth: true,
        size: { w: 100, h: 26 },
      })
    } else {
      elements.push({
        ...base,
        type: "pen",
        color: colors[i % colors.length],
        width: "M",
        size: { w: 100, h: 60 },
        points: Array.from({ length: 12 }, (_, k) => [k * 9, 30 + 25 * Math.sin(k / 2), 0.5]),
      })
    }
  }
  return { syncanvas: 1, elements }
}

/** Pastes `count` Elements into the open Board through the clipboard path, and waits for them. */
async function fill(page: Page, count: number) {
  await page.evaluate((payload) => {
    const json = JSON.stringify(payload)
    const bytes = new TextEncoder().encode(json)
    let binary = ""
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    const data = new DataTransfer()
    data.setData("text/html", `<img src="x" alt="" data-syncanvas="${btoa(binary)}">`)
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data }))
  }, board(count))
  await expect
    .poll(() => page.evaluate(() => window.__syncanvas?.elements().length), { timeout: 120_000 })
    .toBe(count)
}

async function newBoard(page: Page) {
  const res = await page.request.post(`${PROD}/api/boards`, { data: {} })
  const { id } = (await res.json()) as { id: string }
  await page.goto(`${PROD}/b/${id}`)
  await waitUntilOnline(page)
  return id
}

/** Frame times (ms) over `seconds` of wheel input on the canvas: panning, or zooming in and out. */
function measureFrames(page: Page, seconds: number, mode: "pan" | "zoom") {
  return page.evaluate(
    ({ seconds, mode }) =>
      new Promise<number[]>((resolve) => {
        const canvas = document.querySelector(
          'canvas[aria-label="Board canvas"]',
        ) as HTMLCanvasElement
        const box = canvas.getBoundingClientRect()
        const frames: number[] = []
        let last = performance.now()
        const end = last + seconds * 1000
        let i = 0
        const step = (t: number) => {
          frames.push(t - last)
          last = t
          const zoomIn = Math.floor(i / 40) % 2 === 0
          canvas.dispatchEvent(
            new WheelEvent("wheel", {
              deltaX: mode === "pan" ? 6 : 0,
              deltaY: mode === "pan" ? 4 : zoomIn ? -8 : 8,
              ctrlKey: mode === "zoom",
              clientX: box.left + box.width / 2,
              clientY: box.top + box.height / 2,
              bubbles: true,
              cancelable: true,
            }),
          )
          i++
          if (t < end) requestAnimationFrame(step)
          else resolve(frames.slice(2))
        }
        requestAnimationFrame(step)
      }),
    { seconds, mode },
  )
}

function summarize(frames: number[]) {
  const sorted = [...frames].sort((a, b) => a - b)
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
  const slow = frames.filter((f) => f > 20).length / frames.length
  return `${(1000 / mean).toFixed(1)} fps average, p95 frame ${p95.toFixed(1)} ms, ${(slow * 100).toFixed(1)}% of frames over 20 ms (${frames.length} frames)`
}

test("S5: pan and zoom a 5,000-Element Board at 60 fps", async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await enableTestHooks(page)
  await signIn(page, `e2e-perf-s5-${Date.now()}@example.com`)
  await newBoard(page)
  await page.mouse.move(720, 450)
  await fill(page, 5000)
  await page.keyboard.press("Escape") // nothing selected
  // At 100% (the usual working view): a few dozen Elements on screen.
  report(`S5 pan at 100%: ${summarize(await measureFrames(page, 5, "pan"))}`)
  report(`S5 zoom around 100%: ${summarize(await measureFrames(page, 5, "zoom"))}`)
  // Fitted (Shift+1): all 5,000 on screen at once, the worst case.
  await page.keyboard.press("Shift+Digit1")
  await page.waitForTimeout(500)
  report(`S5 pan with all 5,000 visible: ${summarize(await measureFrames(page, 5, "pan"))}`)
  await context.close()
})

test("S6: open a 1,000-Element Board cold (10 Mbps, 50 ms) and warm", async ({ browser }) => {
  // Make the Board, then forget everything but the session.
  const setup = await browser.newContext()
  const page = await setup.newPage()
  await enableTestHooks(page)
  await signIn(page, `e2e-perf-s6-${Date.now()}@example.com`)
  const id = await newBoard(page)
  await page.mouse.move(720, 450)
  await fill(page, 1000)
  await page.waitForTimeout(3000) // stored by the room
  const session = await setup.storageState()
  await setup.close()

  const context = await browser.newContext({
    storageState: { cookies: session.cookies, origins: [] },
  })
  const tab = await context.newPage()
  await enableTestHooks(tab)
  const cdp = await context.newCDPSession(tab)
  await cdp.send("Network.enable")
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 50,
    downloadThroughput: (10 * 1024 * 1024) / 8,
    uploadThroughput: (5 * 1024 * 1024) / 8,
  })
  const elementsShown = () =>
    expect
      .poll(() => tab.evaluate(() => window.__syncanvas?.elements().length ?? 0), {
        intervals: [20],
        timeout: 60_000,
      })
      .toBe(1000)

  // Cold: nothing cached, no local copy. "Editable" = all Elements in and the Board online.
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })
  let start = Date.now()
  await tab.goto(`${PROD}/b/${id}`)
  await elementsShown()
  await waitUntilOnline(tab)
  report(
    `S6 cold open (1,000 Elements, 10 Mbps / 50 ms, no cache): ${Date.now() - start} ms to editable`,
  )

  // Warm: the files cached and the Board's local copy on this device.
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false })
  await tab.waitForTimeout(2000) // the local copy is saved
  await tab.goto(`${PROD}/api/health`)
  start = Date.now()
  await tab.goto(`${PROD}/b/${id}`)
  await elementsShown()
  report(`S6 warm open (cached, local copy): ${Date.now() - start} ms to the Board visible`)
  await waitUntilOnline(tab)
  report(`S6 warm open: ${Date.now() - start} ms to online`)
  await context.close()
})
