// S3/S4 load test (PRD success metrics; M6 ticket 08).
//
// N headless Editors join one Board over the real board-room protocol (y-protocols sync over a
// WebSocket) and each moves its own rectangle about 20 times a second, the rate a drag sends at.
// Every move stamps the send time into the rectangle's position; every other client records how
// long the move took to reach it. All clients run on this machine, so one clock times both ends.
//
//   S3: p95 of those times < 100 ms (same region).
//   S4: 20 Editors at once, and no client ever more than 1 s behind.
//
// Locally (default): signs its own board tokens with the dev key in apps/worker/.dev.vars, for a
// fresh Board id; run `pnpm dev` first. Against another server: pass --url and --token-file (a
// member board token for an existing Board, from POST /api/boards/:id/token; it lasts 5 minutes).
//
//   node tools/loadtest/run.mjs --editors 20 --seconds 60
//   node tools/loadtest/run.mjs --url wss://… --token-file token.txt --board <id> --seconds 90
//
// --fill N first adds N rectangles (from the first client), so the run measures a big Board.

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { importJWK, SignJWT } from "jose"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"

const MESSAGE_SYNC = 0

// ---------- Options ----------

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}
const url = option("url", "ws://localhost:5173")
const editors = Number(option("editors", "20"))
const seconds = Number(option("seconds", "60"))
const rate = Number(option("rate", "20"))
const warmupSeconds = Number(option("warmup", "5"))
const fill = Number(option("fill", "0"))
const tokenFile = option("token-file", null)
const boardId = option("board", `loadtest-${Date.now().toString(36)}`)

// ---------- Board tokens ----------

/** A member Editor token for `boardId`, signed with the local dev key (as the API would). */
async function localToken(userId) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
  const line = readFileSync(join(root, "apps/worker/.dev.vars"), "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("BOARD_TOKEN_PRIVATE_KEY="))
  if (!line) throw new Error("No BOARD_TOKEN_PRIVATE_KEY in apps/worker/.dev.vars")
  const encoded = line.slice("BOARD_TOKEN_PRIVATE_KEY=".length).trim()
  const jwk = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
  const key = await importJWK(jwk, "EdDSA")
  const now = Date.now()
  return new SignJWT({ board: boardId, role: "editor", kind: "member", name: userId, iatMs: now })
    .setProtectedHeader({ alg: "EdDSA" })
    .setSubject(userId)
    .setIssuer("syncanvas-api")
    .setAudience("syncanvas-board-room")
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + 5 * 60)
    .sign(key)
}

// ---------- One headless Editor ----------

/** All latency samples (ms), each from one client seeing another's move. */
const samples = []
let measuring = false

function connect(index, token) {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc()
    const elements = doc.getMap("elements")
    const id = `lt-${index}`
    const client = { index, id, doc, worstLag: 0, received: 0, sent: 0, closed: null, ws: null }
    const ws = new WebSocket(
      `${url}/ws/${encodeURIComponent(boardId)}?token=${encodeURIComponent(token)}`,
    )
    ws.binaryType = "arraybuffer"
    client.ws = ws
    const send = (write) => {
      if (ws.readyState !== WebSocket.OPEN) return
      const e = encoding.createEncoder()
      encoding.writeVarUint(e, MESSAGE_SYNC)
      write(e)
      ws.send(encoding.toUint8Array(e))
    }
    doc.on("update", (update, origin) => {
      if (origin !== "remote") send((e) => syncProtocol.writeUpdate(e, update))
    })
    elements.observeDeep((events) => {
      const now = Date.now()
      for (const event of events) {
        const keys =
          event.target === elements
            ? [...event.changes.keys.keys()]
            : typeof event.path[0] === "string"
              ? [event.path[0]]
              : []
        for (const key of keys) {
          if (key === id || !key.startsWith("lt-")) continue
          const sentAt = elements.get(key)?.get("position")?.y
          if (typeof sentAt !== "number" || sentAt < 1e12) continue
          const latency = now - sentAt
          client.received++
          if (!measuring) continue
          samples.push(latency)
          client.worstLag = Math.max(client.worstLag, latency)
        }
      }
    })
    let synced = false
    ws.addEventListener("open", () => send((e) => syncProtocol.writeSyncStep1(e, doc)))
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") return
      const decoder = decoding.createDecoder(new Uint8Array(event.data))
      if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return // presence and the rest
      const reply = encoding.createEncoder()
      encoding.writeVarUint(reply, MESSAGE_SYNC)
      const kind = syncProtocol.readSyncMessage(decoder, reply, doc, "remote")
      if (encoding.length(reply) > 1) ws.send(encoding.toUint8Array(reply))
      if (!synced && kind === syncProtocol.messageYjsSyncStep2) {
        synced = true
        // Its own rectangle, written once; every move after that only replaces the position.
        doc.transact(() => {
          const rect = new Y.Map()
          rect.set("type", "rect")
          rect.set("position", { x: 0, y: 0 })
          rect.set("size", { w: 40, h: 40 })
          rect.set("z", "a0")
          rect.set("color", "ink")
          rect.set("fill", "none")
          elements.set(id, rect)
        })
        resolve(client)
      }
    })
    ws.addEventListener("close", (event) => {
      client.closed = `${event.code} ${event.reason}`
      if (!synced) reject(new Error(`client ${index} closed before syncing: ${client.closed}`))
    })
    ws.addEventListener("error", () => {
      if (!synced) reject(new Error(`client ${index} couldn't connect to ${url}`))
    })
  })
}

// ---------- The run ----------

function percentile(sorted, p) {
  if (sorted.length === 0) return Number.NaN
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

const sharedToken = tokenFile ? readFileSync(tokenFile, "utf8").trim() : null
console.log(
  `Board ${boardId} at ${url}: ${editors} Editors, ${rate} moves/s each, ${seconds} s (+${warmupSeconds} s warm-up)`,
)
const clients = []
for (let i = 0; i < editors; i++) {
  clients.push(await connect(i, sharedToken ?? (await localToken(`loadtest-editor-${i}`))))
}
console.log(`All ${editors} connected and synced.`)

if (fill > 0) {
  // In batches, so no single message gets near the WebSocket size limit.
  const [first] = clients
  for (let done = 0; done < fill; done += 500) {
    first.doc.transact(() => {
      const elements = first.doc.getMap("elements")
      for (let i = done; i < Math.min(fill, done + 500); i++) {
        const rect = new Y.Map()
        rect.set("type", "rect")
        rect.set("position", { x: (i % 100) * 60, y: Math.floor(i / 100) * 60 })
        rect.set("size", { w: 40, h: 40 })
        rect.set("z", "a0")
        rect.set("color", "blue")
        rect.set("fill", "light")
        elements.set(`fill-${i}`, rect)
      }
    })
  }
  const total = fill + editors
  while (clients.some((c) => c.doc.getMap("elements").size < total)) {
    await new Promise((r) => setTimeout(r, 100))
  }
  console.log(`Board filled: ${total} Elements.`)
}

const timers = clients.map((client) =>
  setInterval(() => {
    const rect = client.doc.getMap("elements").get(client.id)
    if (!rect || client.closed) return
    client.sent++
    // The send time rides in the position: receivers subtract it from their own clock.
    rect.set("position", { x: client.sent % 1000, y: Date.now() })
  }, 1000 / rate),
)

await new Promise((r) => setTimeout(r, warmupSeconds * 1000))
measuring = true
const started = Date.now()
await new Promise((r) => setTimeout(r, seconds * 1000))
measuring = false
for (const t of timers) clearInterval(t)
await new Promise((r) => setTimeout(r, 1000))

const sorted = [...samples].sort((a, b) => a - b)
const worst = Math.max(...clients.map((c) => c.worstLag))
const result = {
  url,
  boardId,
  editors,
  ratePerEditor: rate,
  seconds: (Date.now() - started) / 1000,
  updatesSent: clients.reduce((n, c) => n + c.sent, 0),
  samples: sorted.length,
  latencyMs: {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1),
  },
  worstClientLagMs: worst,
  closedSockets: clients.filter((c) => c.closed).map((c) => `${c.index}: ${c.closed}`),
  S3: percentile(sorted, 95) < 100 ? "pass" : "miss",
  S4: worst <= 1000 && clients.every((c) => !c.closed) ? "pass" : "miss",
}
console.log(JSON.stringify(result, null, 2))
for (const c of clients) c.ws.close(1000, "load test done")
process.exit(0)
