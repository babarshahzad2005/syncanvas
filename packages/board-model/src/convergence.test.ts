import { canEdit, type Role } from "@syncanvas/shared"
import * as fc from "fast-check"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import { describe, expect, it, vi } from "vitest"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"
import {
  addArrow,
  addPen,
  addShape,
  addSticky,
  addText,
  alignUnits,
  applyTextChange,
  checkUpdate,
  createUndoManager,
  deleteElements,
  distributeUnits,
  type ElementWithId,
  elementsOf,
  expandToGroups,
  groupElements,
  isOrderKey,
  listElements,
  moveElement,
  moveElements,
  moveUnits,
  PALETTE_COLORS,
  recolorElement,
  reorderElements,
  STICKY_COLORS,
  scaledGeometry,
  setFill,
  setGeometry,
  setLocked,
  setTextStyle,
  textOf,
  ungroupElements,
  validateBoardDoc,
} from "./index"

// Convergence suite (spec: S1/S2). Many in-memory clients edit one Board through the
// board-model API while a simulated network delays, interleaves, and drops their messages and
// takes them offline. A simulated server applies the board room's real acceptance rules
// (`checkUpdate`). After everything is delivered, every client must hold the same Board, and
// nothing the server accepted may be missing anywhere.
//
// The network is modelled the way WebSockets behave: each client↔server link is FIFO, and
// "delay" is how long a message waits before a `deliver` command picks its link, so messages
// on different links arrive in any order. A drop is a lost connection: everything in flight
// on that client's links is gone, and the client resyncs (Yjs sync steps 1 and 2 both ways)
// when it reconnects, exactly as BoardConnection does.
//
// Replaying a failure: fast-check prints the seed, path, and shrunk command list. Pass
// `{ seed, path, endOnFailure: true }` to the fc.assert below to rerun just that case.
//
// Later M1 tickets add their operations to `editCommand` and `runEdit`.

const MESSAGE_SYNC = 0
const LOCAL = Symbol("local edit")
const REMOTE = Symbol("from the room")

/** 5 clients that may edit, plus 2 read-only ones that still sync (and replay on reconnect). */
const ROLES: Role[] = ["owner", "editor", "editor", "editor", "editor", "commenter", "viewer"]
const EDITORS = ROLES.flatMap((role, i) => (canEdit(role) ? [i] : []))

function syncMessage(write: (encoder: encoding.Encoder) => void) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

class SimClient {
  readonly doc = new Y.Doc()
  readonly undo: Y.UndoManager
  online = false
  toServer: Uint8Array[] = []
  toClient: Uint8Array[] = []
  readonly index: number
  readonly role: Role

  constructor(index: number, role: Role) {
    this.index = index
    this.role = role
    // Fixed client ids, so a seed replays the same conflict resolutions.
    this.doc.clientID = index + 1
    this.undo = createUndoManager(this.doc, LOCAL) // the app's own undo setup
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return // came from the room; don't echo it back
      if (!canEdit(this.role)) return // read-only: nothing of ours to send
      this.send(syncMessage((e) => syncProtocol.writeUpdate(e, update)))
    })
  }

  send(message: Uint8Array) {
    if (this.online) this.toServer.push(message)
  }

  receive(message: Uint8Array) {
    const decoder = decoding.createDecoder(message)
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return
    const reply = encoding.createEncoder()
    encoding.writeVarUint(reply, MESSAGE_SYNC)
    syncProtocol.readSyncMessage(decoder, reply, this.doc, REMOTE)
    if (encoding.length(reply) > 1) this.send(encoding.toUint8Array(reply))
  }
}

class SimServer {
  readonly doc = new Y.Doc()
  readonly accepted: Uint8Array[] = []
  readonly refusals: string[] = []
  readonly clients: SimClient[]

  constructor(clients: SimClient[]) {
    this.clients = clients
  }

  connect(client: SimClient) {
    if (client.online) return
    client.online = true
    // The room sends its step 1 on upgrade; the client sends its own when the socket opens.
    client.toClient.push(syncMessage((e) => syncProtocol.writeSyncStep1(e, this.doc)))
    client.send(syncMessage((e) => syncProtocol.writeSyncStep1(e, client.doc)))
  }

  disconnect(client: SimClient) {
    client.online = false
    client.toServer = []
    client.toClient = []
  }

  receive(client: SimClient, message: Uint8Array) {
    const decoder = decoding.createDecoder(message)
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return
    switch (decoding.readVarUint(decoder)) {
      case syncProtocol.messageYjsSyncStep1: {
        const stateVector = decoding.readVarUint8Array(decoder)
        client.toClient.push(
          syncMessage((e) => syncProtocol.writeSyncStep2(e, this.doc, stateVector)),
        )
        return
      }
      case syncProtocol.messageYjsSyncStep2:
      case syncProtocol.messageYjsUpdate:
        this.receiveUpdate(client, decoding.readVarUint8Array(decoder))
    }
  }

  private receiveUpdate(client: SimClient, update: Uint8Array) {
    const verdict = checkUpdate(this.doc, update, canEdit(client.role))
    if (verdict === "unchanged" || verdict === "incomplete") return
    if (verdict !== "accepted") {
      // Say which Element broke and how, so a failure is readable without a debugger.
      const scratch = new Y.Doc()
      Y.applyUpdate(scratch, Y.encodeStateAsUpdate(this.doc))
      Y.applyUpdate(scratch, update)
      const problems = validateBoardDoc(scratch)
      const detail = problems.map((p) => {
        const id = p.split(" ")[1] ?? ""
        return `${p}: ${JSON.stringify(elementsOf(scratch).get(id)?.toJSON())}`
      })
      this.refusals.push(
        `${verdict} update from client ${client.index} (${client.role}) ${detail.join("; ")}`,
      )
      this.disconnect(client)
      return
    }
    this.accepted.push(update)
    Y.applyUpdate(this.doc, update)
    const outgoing = syncMessage((e) => syncProtocol.writeUpdate(e, update))
    for (const other of this.clients) {
      if (other !== client && other.online) other.toClient.push(outgoing)
    }
  }

  /** Delivers the oldest message on one direction of one client's link. */
  deliver(client: SimClient, to: "server" | "client") {
    if (to === "server") {
      const message = client.toServer.shift()
      if (message) this.receive(client, message)
    } else {
      const message = client.toClient.shift()
      if (message) client.receive(message)
    }
  }

  /** Brings everyone online and delivers until nothing is in flight. */
  quiesce() {
    for (const client of this.clients) this.connect(client)
    for (let round = 0; ; round++) {
      if (round > 100_000) throw new Error("network never went quiet")
      let delivered = false
      for (const client of this.clients) {
        if (client.toServer.length > 0) {
          this.deliver(client, "server")
          delivered = true
        }
        if (client.toClient.length > 0) {
          this.deliver(client, "client")
          delivered = true
        }
      }
      if (!delivered) return
    }
  }
}

// ---------- Commands ----------

const editor = fc.constantFrom(...EDITORS)
const anyClient = fc.integer({ min: 0, max: ROLES.length - 1 })
const coordinate = fc.integer({ min: -1000, max: 1000 })
const extent = fc.integer({ min: -300, max: 300 })
const color = fc.constantFrom(...PALETTE_COLORS)
const fill = fc.constantFrom("none" as const, "light" as const, "solid" as const)
/** Which Element to act on: an index into the client's own Element list, modulo its length. */
const pick = fc.nat({ max: 1000 })

/** An Element's stored box (the UI uses drawn boxes; any box works for convergence). */
const storedBox = (e: ElementWithId) =>
  "position" in e ? { x: e.position.x, y: e.position.y, w: e.size.w, h: e.size.h } : null

const editCommand = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      op: fc.constant("create" as const),
      client: editor,
      type: fc.constantFrom("rect" as const, "ellipse" as const),
      fill,
      x: coordinate,
      y: coordinate,
      w: extent,
      h: extent,
      color,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      op: fc.constant("pen" as const),
      client: editor,
      points: fc.array(
        fc.tuple(coordinate, coordinate, fc.double({ min: 0, max: 1, noNaN: true })),
        {
          minLength: 1,
          maxLength: 20,
        },
      ),
      color,
      width: fc.constantFrom("S" as const, "M" as const, "L" as const),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      op: fc.constant("arrow" as const),
      client: editor,
      x: coordinate,
      y: coordinate,
      x2: coordinate,
      y2: coordinate,
      color,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      op: fc.constant("text" as const),
      client: editor,
      x: coordinate,
      y: coordinate,
      width: fc.option(fc.integer({ min: 20, max: 400 }), { nil: null }),
      content: fc.string({ maxLength: 8 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      op: fc.constant("sticky" as const),
      client: editor,
      x: coordinate,
      y: coordinate,
      color: fc.constantFrom(...STICKY_COLORS),
      content: fc.string({ maxLength: 8 }),
    }),
  },
  {
    // Size and bold for texts and stickies (XL is ignored for stickies).
    weight: 1,
    arbitrary: fc.record({
      op: fc.constant("style" as const),
      client: editor,
      pick,
      fontSize: fc.constantFrom("S" as const, "M" as const, "L" as const, "XL" as const),
      bold: fc.boolean(),
    }),
  },
  {
    // Typing into (or replacing part of) a text or sticky: concurrent edits must merge.
    weight: 3,
    arbitrary: fc.record({
      op: fc.constant("type" as const),
      client: editor,
      pick,
      at: fc.nat({ max: 1000 }),
      remove: fc.nat({ max: 4 }),
      // Graphemes include emoji, so edits next to surrogate pairs are covered.
      insert: fc.string({ maxLength: 6, unit: "grapheme" }),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      op: fc.constant("move" as const),
      client: editor,
      pick,
      x: coordinate,
      y: coordinate,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ op: fc.constant("recolor" as const), client: editor, pick, color }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ op: fc.constant("fill" as const), client: editor, pick, fill }),
  },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("delete" as const), client: editor, pick }) },
  {
    // A multi-selection moved together: several Elements by the same offset.
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant("multiMove" as const),
      client: editor,
      picks: fc.array(pick, { minLength: 2, maxLength: 5 }),
      dx: fc.integer({ min: -200, max: 200 }),
      dy: fc.integer({ min: -200, max: 200 }),
    }),
  },
  {
    // Resizing one Element, or scaling a multi-selection around its corner.
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant("scale" as const),
      client: editor,
      picks: fc.array(pick, { minLength: 1, maxLength: 4 }),
      sx: fc.integer({ min: 25, max: 400 }),
      sy: fc.integer({ min: 25, max: 400 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant("group" as const),
      client: editor,
      picks: fc.array(pick, { minLength: 2, maxLength: 4 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      op: fc.constant("ungroup" as const),
      client: editor,
      picks: fc.array(pick, { minLength: 1, maxLength: 3 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      op: fc.constant("lock" as const),
      client: editor,
      picks: fc.array(pick, { minLength: 1, maxLength: 3 }),
      locked: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      op: fc.constant("reorder" as const),
      client: editor,
      picks: fc.array(pick, { minLength: 1, maxLength: 3 }),
      direction: fc.constantFrom("forward" as const, "backward" as const),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      op: fc.constant("align" as const),
      client: editor,
      picks: fc.array(pick, { minLength: 2, maxLength: 4 }),
      mode: fc.constantFrom(
        "left" as const,
        "center" as const,
        "right" as const,
        "top" as const,
        "middle" as const,
        "bottom" as const,
        "horizontal" as const,
        "vertical" as const,
      ),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      op: fc.constant("multiDelete" as const),
      client: editor,
      picks: fc.array(pick, { minLength: 2, maxLength: 5 }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("undo" as const), client: editor }) },
  { weight: 1, arbitrary: fc.record({ op: fc.constant("redo" as const), client: editor }) },
)
type EditCommand = typeof editCommand extends fc.Arbitrary<infer T> ? T : never

const networkCommand = fc.oneof(
  {
    weight: 12,
    arbitrary: fc.record({
      op: fc.constant("deliver" as const),
      client: anyClient,
      to: fc.constantFrom("server" as const, "client" as const),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({ op: fc.constant("disconnect" as const), client: anyClient }),
  },
  { weight: 2, arbitrary: fc.record({ op: fc.constant("reconnect" as const), client: anyClient }) },
)

const command = fc.oneof(
  { weight: 1, arbitrary: editCommand },
  { weight: 1, arbitrary: networkCommand },
)
type Command = typeof command extends fc.Arbitrary<infer T> ? T : never

function runEdit(client: SimClient, c: EditCommand) {
  const { doc } = client
  const picked = (picks: number[]) => {
    const all = listElements(doc)
    if (all.length === 0) return []
    return [...new Set(picks.map((p) => all[p % all.length]))].flatMap((e) => (e ? [e] : []))
  }
  const target = () => {
    if (!("pick" in c)) return undefined
    const all = listElements(doc)
    return all.length === 0 ? undefined : all[c.pick % all.length]?.id
  }
  switch (c.op) {
    case "create":
      addShape(
        doc,
        {
          type: c.type,
          position: { x: c.x, y: c.y },
          size: { w: c.w, h: c.h },
          color: c.color,
          fill: c.fill,
        },
        LOCAL,
      )
      break
    case "pen":
      addPen(doc, { points: c.points, color: c.color, width: c.width, tolerance: 0.5 }, LOCAL)
      break
    case "arrow":
      addArrow(doc, { from: { x: c.x, y: c.y }, to: { x: c.x2, y: c.y2 }, color: c.color }, LOCAL)
      break
    case "text":
      addText(
        doc,
        { position: { x: c.x, y: c.y }, width: c.width, lineHeight: 26, content: c.content },
        LOCAL,
      )
      break
    case "sticky":
      addSticky(doc, { center: { x: c.x, y: c.y }, color: c.color, content: c.content }, LOCAL)
      break
    case "style": {
      const id = target()
      if (id) setTextStyle(doc, id, { fontSize: c.fontSize, bold: c.bold }, LOCAL)
      break
    }
    case "type": {
      const texts = listElements(doc).filter((e) => e.type === "text" || e.type === "sticky")
      const element = texts[c.pick % Math.max(1, texts.length)]
      const text = element && textOf(doc, element.id)
      if (!text) break
      const before = text.toString()
      // Like a real caret, never stop between the two halves of an emoji.
      const snap = (i: number) => {
        const code = before.charCodeAt(i)
        return i > 0 && code >= 0xdc00 && code <= 0xdfff ? i - 1 : i
      }
      const at = snap(c.at % (before.length + 1))
      const to = snap(Math.min(before.length, at + c.remove))
      const after = before.slice(0, at) + c.insert + before.slice(to)
      applyTextChange(text, before, after, LOCAL)
      break
    }
    case "move": {
      const id = target()
      if (id) moveElement(doc, id, { x: c.x, y: c.y }, LOCAL)
      break
    }
    case "recolor": {
      const id = target()
      if (id) recolorElement(doc, id, c.color, LOCAL)
      break
    }
    case "fill": {
      const id = target()
      if (id) setFill(doc, id, c.fill, LOCAL)
      break
    }
    case "multiMove": {
      const moved = picked(c.picks).flatMap((e) =>
        "position" in e
          ? [[e.id, { x: e.position.x + c.dx, y: e.position.y + c.dy }] as const]
          : [],
      )
      moveElements(doc, moved, LOCAL)
      break
    }
    case "scale": {
      const chosen = picked(c.picks).filter((e) => e.type !== "connector")
      if (chosen.length === 0) break
      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const e of chosen) {
        if (!("position" in e)) continue
        minX = Math.min(minX, e.position.x)
        minY = Math.min(minY, e.position.y)
        maxX = Math.max(maxX, e.position.x + e.size.w)
        maxY = Math.max(maxY, e.position.y + e.size.h)
      }
      const from = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
      const to = { ...from, w: (from.w * c.sx) / 100, h: (from.h * c.sy) / 100 }
      setGeometry(
        doc,
        chosen.flatMap((e) => {
          const g = scaledGeometry(e, from, to, chosen.length === 1)
          return g ? [[e.id, g] as const] : []
        }),
        LOCAL,
      )
      break
    }
    case "group":
      // Like the UI: grouping a member takes its whole group along (groups merge).
      groupElements(
        doc,
        expandToGroups(
          picked(c.picks).map((e) => e.id),
          listElements(doc),
        ),
        LOCAL,
      )
      break
    case "ungroup":
      ungroupElements(
        doc,
        picked(c.picks).map((e) => e.id),
        LOCAL,
      )
      break
    case "lock":
      setLocked(
        doc,
        picked(c.picks).map((e) => e.id),
        c.locked,
        LOCAL,
      )
      break
    case "reorder":
      reorderElements(
        doc,
        picked(c.picks).map((e) => e.id),
        c.direction,
        storedBox,
        LOCAL,
      )
      break
    case "align": {
      const units = picked(c.picks).flatMap((e) => {
        const box = storedBox(e)
        return box ? [{ ids: [e.id], box }] : []
      })
      const offsets =
        c.mode === "horizontal" || c.mode === "vertical"
          ? distributeUnits(units, c.mode)
          : alignUnits(units, c.mode)
      moveUnits(doc, units, offsets, LOCAL)
      break
    }
    case "multiDelete":
      deleteElements(
        doc,
        picked(c.picks).map((e) => e.id),
        LOCAL,
      )
      break
    case "delete": {
      const id = target()
      if (id) deleteElements(doc, [id], LOCAL)
      break
    }
    case "undo":
      client.undo.undo()
      break
    case "redo":
      client.undo.redo()
      break
  }
  client.undo.stopCapturing()
}

// ---------- The property ----------

let editsRun = 0

function simulate(commands: Command[]) {
  // Deterministic Element ids, so a seed replays exactly.
  let nextId = 0
  const uuid = vi
    .spyOn(crypto, "randomUUID")
    .mockImplementation(() => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`)
  try {
    const clients = ROLES.map((role, i) => new SimClient(i, role))
    const server = new SimServer(clients)
    for (const client of clients) server.connect(client)

    for (const c of commands) {
      const client = clients[c.client]
      if (!client) continue
      if (c.op === "deliver") server.deliver(client, c.to)
      else if (c.op === "disconnect") server.disconnect(client)
      else if (c.op === "reconnect") server.connect(client)
      else {
        runEdit(client, c)
        editsRun++
      }
    }
    server.quiesce()

    expect(server.refusals).toEqual([])
    const expected = listElements(server.doc)
    const expectedJson = elementsOf(server.doc).toJSON()
    const allAccepted = server.accepted.length > 0 ? Y.mergeUpdates(server.accepted) : null
    for (const { doc } of [server, ...clients]) {
      // Nothing stuck waiting for missing history.
      expect(doc.store.pendingStructs).toBeNull()
      expect(doc.store.pendingDs).toBeNull()
      // S1: the same document state (state vector + delete set) and the same Board.
      expect(Y.equalSnapshots(Y.snapshot(doc), Y.snapshot(server.doc))).toBe(true)
      expect(listElements(doc)).toEqual(expected)
      // Reordering never loses or duplicates an Element in the z order, and every key stays
      // valid (so the next reorder or new Element can always find a key).
      expect(new Set(listElements(doc).map((e) => e.id)).size).toBe(elementsOf(doc).size)
      expect(listElements(doc).every((e) => isOrderKey(e.z))).toBe(true)
      expect(elementsOf(doc).toJSON()).toEqual(expectedJson)
      // S2: every update the server accepted is already contained in this document.
      if (allAccepted) {
        const probe = new Y.Doc()
        Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc))
        Y.applyUpdate(probe, allAccepted)
        expect(Y.equalSnapshots(Y.snapshot(probe), Y.snapshot(doc))).toBe(true)
      }
    }
    expect(validateBoardDoc(server.doc)).toEqual([])
  } finally {
    uuid.mockRestore()
  }
}

describe("convergence", () => {
  it("every client ends with the same Board, and nothing accepted is lost", () => {
    fc.assert(fc.property(fc.array(command, { minLength: 400, maxLength: 500 }), simulate), {
      numRuns: 100,
    })
    // At least 10,000 edits per run of the suite (spec), counted across all cases.
    expect(editsRun).toBeGreaterThanOrEqual(10_000)
  }, 120_000)
})
