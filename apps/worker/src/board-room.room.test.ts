import { env, evictDurableObject, SELF } from "cloudflare:test"
import { ELEMENT_CAP, elementsOf, TEXT_LIMIT } from "@syncanvas/board-model"
import type { Role } from "@syncanvas/shared"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import { describe, expect, it } from "vitest"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"
import { CLOSE, MESSAGE_SYNC } from "./board-room"
import { type BoardTokenKind, signBoardToken } from "./board-token"
import {
  decodePresence,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  type PresenceEntry,
  presenceMessage,
  REMOVED_CLOCK,
} from "./presence"

// Board room socket seam: headless Yjs clients speaking the real protocol to the real
// BoardRoom Durable Object in workerd.

const tick = () => new Promise((r) => setTimeout(r, 20))
async function until(check: () => boolean, label: string, ms = 3000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${label}`)
    await tick()
  }
}

let boardCounter = 0
const newBoardId = () => `board-${Date.now()}-${boardCounter++}`

class TestClient {
  readonly doc = new Y.Doc()
  closed: { code: number; reason: string } | null = null
  synced = false
  /** Presence entries received, in order, and how many presence queries arrived. */
  readonly presence: PresenceEntry[] = []
  queries = 0
  readonly ws: WebSocket
  private constructor(ws: WebSocket) {
    this.ws = ws
  }

  static async connect(boardId: string, token: string) {
    const res = await SELF.fetch(
      `https://syncanvas.test/ws/${boardId}?token=${encodeURIComponent(token)}`,
      {
        headers: { Upgrade: "websocket" },
      },
    )
    const ws = res.webSocket
    if (!ws) throw new Error(`no WebSocket (status ${res.status})`)
    const client = new TestClient(ws)
    ws.accept()
    // workerd delivers binary frames to test-side sockets as Blobs; decode them in arrival order.
    let queue = Promise.resolve()
    ws.addEventListener("message", (e) => {
      const data = e.data as ArrayBuffer | Blob
      queue = queue.then(async () =>
        client.onMessage(data instanceof Blob ? await data.arrayBuffer() : data),
      )
    })
    ws.addEventListener("close", (e) => {
      client.closed = { code: e.code, reason: e.reason }
    })
    client.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === client || client.closed) return
      client.send((e) => syncProtocol.writeUpdate(e, update))
    })
    client.send((e) => syncProtocol.writeSyncStep1(e, client.doc))
    return client
  }

  private send(write: (e: encoding.Encoder) => void) {
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, MESSAGE_SYNC)
    write(e)
    this.ws.send(encoding.toUint8Array(e))
  }

  private onMessage(data: ArrayBuffer) {
    const decoder = decoding.createDecoder(new Uint8Array(data))
    const type = decoding.readVarUint(decoder)
    if (type === MESSAGE_AWARENESS) {
      this.presence.push(...decodePresence(decoding.readVarUint8Array(decoder)))
      return
    }
    if (type === MESSAGE_QUERY_AWARENESS) {
      this.queries++
      return
    }
    if (type !== MESSAGE_SYNC) return
    const reply = encoding.createEncoder()
    encoding.writeVarUint(reply, MESSAGE_SYNC)
    const syncType = syncProtocol.readSyncMessage(decoder, reply, this.doc, this)
    if (encoding.length(reply) > 1) this.ws.send(encoding.toUint8Array(reply))
    if (syncType === syncProtocol.messageYjsSyncStep2) this.synced = true
  }

  /** Publishes a presence state (JSON) under an awareness id, as a y-protocols client would. */
  sendPresence(clientId: number, state: unknown, clock = 1) {
    this.ws.send(presenceMessage([{ clientId, clock, state: JSON.stringify(state) }]))
  }

  /** The latest presence received for an awareness id, parsed (null once removed). */
  presenceOf(clientId: number): Record<string, unknown> | null | undefined {
    const entry = this.presence.filter((e) => e.clientId === clientId).at(-1)
    return entry ? JSON.parse(entry.state) : undefined
  }

  /** Sends a raw update as if this client had produced it. */
  sendUpdate(update: Uint8Array) {
    this.send((e) => syncProtocol.writeUpdate(e, update))
  }

  addRect(id: string, fields: Record<string, unknown> = {}) {
    const m = new Y.Map<unknown>()
    const all = {
      type: "rect",
      position: { x: 10, y: 20 },
      size: { w: 100, h: 60 },
      z: "a0",
      color: "ink",
      ...fields,
    }
    for (const [k, v] of Object.entries(all)) m.set(k, v)
    elementsOf(this.doc).set(id, m)
  }

  rect(id: string) {
    return elementsOf(this.doc).get(id)?.toJSON() as Record<string, unknown> | undefined
  }

  close() {
    if (!this.closed) this.ws.close(1000, "done")
  }
}

async function token(
  boardId: string,
  role: Role,
  extra: { kind?: BoardTokenKind; now?: number } = {},
) {
  const signed = await signBoardToken(
    { userId: `user-${role}`, name: `User ${role}`, boardId, role, kind: extra.kind ?? "member" },
    env.BOARD_TOKEN_PRIVATE_KEY,
    extra.now,
  )
  return signed.token
}

async function join(boardId: string, role: Role, ms?: number) {
  const client = await TestClient.connect(boardId, await token(boardId, role))
  await until(() => client.synced, `${role} to sync`, ms)
  return client
}

describe("BoardRoom", () => {
  it("syncs an Editor's edit to another Editor", async () => {
    const board = newBoardId()
    const a = await join(board, "editor")
    const b = await join(board, "owner")

    a.addRect("r1")
    await until(() => b.rect("r1") !== undefined, "B to see A's rectangle")
    expect(b.rect("r1")).toMatchObject({ type: "rect", position: { x: 10, y: 20 } })
    a.close()
    b.close()
  })

  it("rejects a Viewer's update: the socket closes and nothing is stored or broadcast", async () => {
    const board = newBoardId()
    const editor = await join(board, "editor")
    const viewer = await join(board, "viewer")

    viewer.addRect("sneaky")
    await until(() => viewer.closed !== null, "viewer to be closed")
    expect(viewer.closed?.code).toBe(CLOSE.forbidden)

    await new Promise((r) => setTimeout(r, 200))
    expect(editor.rect("sneaky")).toBeUndefined()
    const late = await join(board, "editor")
    expect(late.rect("sneaky")).toBeUndefined()
    editor.close()
    late.close()
  })

  it("lets a Viewer re-send content the room already has without being disconnected", async () => {
    const board = newBoardId()
    const editor = await join(board, "editor")
    editor.addRect("known")
    const viewer = await join(board, "viewer")
    await until(() => viewer.rect("known") !== undefined, "viewer to see the rectangle")

    // Like a reconnecting client replaying its local copy.
    viewer.sendUpdate(Y.encodeStateAsUpdate(viewer.doc))
    await new Promise((r) => setTimeout(r, 300))
    expect(viewer.closed).toBeNull()
    editor.close()
    viewer.close()
  })

  it.each<[string, () => Promise<string>, string, number]>([
    ["a forged token", async () => "not-a-jwt", "board-forged", CLOSE.invalidToken],
    [
      "an expired token",
      async () => token("board-expired", "editor", { now: Date.now() - 10 * 60_000 }),
      "board-expired",
      CLOSE.invalidToken,
    ],
    [
      "a token for another Board",
      async () => token("board-a", "editor"),
      "board-b",
      CLOSE.forbidden,
    ],
  ])("refuses %s at connect", async (_label, makeToken, board, code) => {
    const client = await TestClient.connect(board, await makeToken())
    await until(() => client.closed !== null, "refusal")
    expect(client.closed?.code).toBe(code)
    expect(client.synced).toBe(false)
  })

  it("rejects an update that would make the Board invalid", async () => {
    const board = newBoardId()
    const a = await join(board, "editor")
    a.addRect("bad", { color: "#ff0000" })
    await until(() => a.closed !== null, "invalid update to be refused")
    expect(a.closed?.code).toBe(CLOSE.invalidUpdate)

    const b = await join(board, "editor")
    expect(b.rect("bad")).toBeUndefined()
    b.close()
  })

  it("accepts valid v2 Elements, including collaborative text", async () => {
    const board = newBoardId()
    const a = await join(board, "editor")
    const b = await join(board, "editor")
    a.doc.transact(() => {
      const sticky = new Y.Map<unknown>()
      for (const [k, v] of Object.entries({
        type: "sticky",
        position: { x: 0, y: 0 },
        size: { w: 200, h: 200 },
        z: "a0",
        color: "yellow",
        text: new Y.Text("retro idea"),
        fontSize: "M",
        bold: false,
        groupId: "g1",
      }))
        sticky.set(k, v)
      elementsOf(a.doc).set("sticky", sticky)
    })
    a.addRect("pen", {
      type: "pen",
      width: "S",
      points: [
        [0, 0, 0.5],
        [5, 5, 0.5],
      ],
      groupId: "g1",
    })
    await until(() => b.rect("pen") !== undefined, "v2 Elements to reach the other Editor")
    expect(b.rect("sticky")).toMatchObject({ type: "sticky", text: "retro idea" })
    expect(a.closed).toBeNull()
    a.close()
    b.close()
  })

  it("rejects an invalid v2 Element", async () => {
    const board = newBoardId()
    const a = await join(board, "editor")
    a.addRect("bad-pen", { type: "pen", width: "S", points: [[0, 0, 7]] })
    await until(() => a.closed !== null, "invalid pen to be refused")
    expect(a.closed?.code).toBe(CLOSE.invalidUpdate)

    const b = await join(board, "editor")
    expect(b.rect("bad-pen")).toBeUndefined()
    b.close()
  })

  it("rejects text longer than the per-Element limit", async () => {
    const board = newBoardId()
    const a = await join(board, "editor")
    a.doc.transact(() => {
      const fields = new Y.Map<unknown>()
      for (const [k, v] of Object.entries({
        type: "text",
        position: { x: 0, y: 0 },
        size: { w: 0, h: 26 },
        z: "a0",
        color: "ink",
        text: new Y.Text("x".repeat(TEXT_LIMIT + 1)),
        fontSize: "M",
        bold: false,
        align: "left",
        autoWidth: true,
      }))
        fields.set(k, v)
      elementsOf(a.doc).set("long", fields)
    })
    await until(() => a.closed !== null, "the over-long text to be refused")
    expect(a.closed?.code).toBe(CLOSE.invalidUpdate)
  })

  it("enforces the Element cap", async () => {
    const board = newBoardId()
    const a = await join(board, "editor")
    // Fill to exactly the cap in a few updates (one message per transaction), each accepted.
    const batch = 5_000
    for (let start = 0; start < ELEMENT_CAP; start += batch) {
      a.doc.transact(() => {
        for (let i = start; i < start + batch; i++) a.addRect(`r${i}`)
      })
    }
    const b = await join(board, "viewer", 20_000) // the room may still be checking the batches
    await until(() => elementsOf(b.doc).size === ELEMENT_CAP, "the full Board to sync", 20_000)
    expect(a.closed).toBeNull()

    a.addRect("one-too-many")
    await until(() => a.closed !== null, "the over-cap update to be refused", 10_000)
    expect(a.closed?.code).toBe(CLOSE.invalidUpdate)
    expect(b.rect("one-too-many")).toBeUndefined()
    b.close()
  }, 60_000)

  it("keeps the Board when the room is evicted from memory", async () => {
    const board = newBoardId()
    const a = await join(board, "editor")
    a.addRect("kept", { position: { x: 5, y: 6 } })
    // Wait until a second client sees it, so it has been persisted and broadcast.
    const witness = await join(board, "editor")
    await until(() => witness.rect("kept") !== undefined, "witness to see the rectangle")
    a.close()
    witness.close()

    await evictDurableObject(env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(board)), {
      webSockets: "close",
    })

    const after = await join(board, "editor")
    expect(after.rect("kept")).toMatchObject({ position: { x: 5, y: 6 } })
    after.close()
  })

  it("converges when two Editors move the same rectangle at the same time", async () => {
    const board = newBoardId()
    const a = await join(board, "editor")
    const b = await join(board, "editor")
    a.addRect("shared")
    await until(() => b.rect("shared") !== undefined, "B to see the rectangle")

    // Both move it before hearing about each other's move.
    elementsOf(a.doc).get("shared")?.set("position", { x: 100, y: 100 })
    elementsOf(b.doc).get("shared")?.set("position", { x: 300, y: 300 })

    await until(
      () => JSON.stringify(a.rect("shared")) === JSON.stringify(b.rect("shared")),
      "A and B to converge",
    )
    const final = a.rect("shared")?.position
    // One of the two chosen positions, never a mix (ADR 0002).
    expect([JSON.stringify({ x: 100, y: 100 }), JSON.stringify({ x: 300, y: 300 })]).toContain(
      JSON.stringify(final),
    )
    a.close()
    b.close()
  })

  describe("presence", () => {
    it("relays presence to everyone, with the identity from the token", async () => {
      const board = newBoardId()
      const editor = await join(board, "editor")
      const viewer = await join(board, "viewer")

      // A client can't pick its own name or id: the room stamps the token's.
      editor.sendPresence(111, {
        cursor: { x: 1, y: 2 },
        user: { id: "someone-else", name: "Mallory" },
      })
      await until(() => viewer.presenceOf(111) !== undefined, "the viewer to see the editor")
      expect(viewer.presenceOf(111)).toEqual({
        cursor: { x: 1, y: 2 },
        user: { id: "user-editor", name: "User editor", guest: false },
      })

      // Every Role publishes presence, Viewers included.
      viewer.sendPresence(222, { cursor: null })
      await until(() => editor.presenceOf(222) !== undefined, "the editor to see the viewer")
      expect(editor.presenceOf(222)).toMatchObject({ user: { id: "user-viewer" } })
      editor.close()
      viewer.close()
    })

    it("shows a joiner everyone already there, at once", async () => {
      const board = newBoardId()
      const a = await join(board, "editor")
      a.sendPresence(111, { here: true })
      const witness = await join(board, "owner")
      await until(() => witness.presenceOf(111) !== undefined, "the witness to see A")

      const late = await join(board, "viewer")
      await until(() => late.presenceOf(111) !== undefined, "the joiner to see A")
      expect(late.presenceOf(111)).toMatchObject({ here: true, user: { id: "user-editor" } })
      a.close()
      witness.close()
      late.close()
    })

    it("tells everyone when someone leaves", async () => {
      const board = newBoardId()
      const a = await join(board, "editor")
      const b = await join(board, "owner")
      a.sendPresence(111, { here: true })
      await until(() => b.presenceOf(111) !== undefined, "B to see A")

      a.close()
      await until(() => b.presenceOf(111) === null, "B to see A leave")
      expect(b.presence.at(-1)).toMatchObject({ clientId: 111, clock: REMOVED_CLOCK })
      b.close()
    })

    it("gives each connection one awareness id that nobody else can use", async () => {
      const board = newBoardId()
      const a = await join(board, "editor")
      const b = await join(board, "editor")
      const watcher = await join(board, "viewer")
      a.sendPresence(111, { from: "a" })
      await until(() => watcher.presenceOf(111) !== undefined, "the watcher to see A")

      // B can neither overwrite nor remove A's presence, nor publish under a second id.
      b.sendPresence(111, { from: "b" }, 5)
      b.sendPresence(111, null, 6)
      b.sendPresence(333, { from: "b" })
      b.sendPresence(444, { from: "b again" })
      await until(() => watcher.presenceOf(333) !== undefined, "the watcher to see B")
      await new Promise((r) => setTimeout(r, 100))
      expect(watcher.presenceOf(111)).toMatchObject({ from: "a" })
      expect(watcher.presenceOf(444)).toBeUndefined()
      a.close()
      b.close()
      watcher.close()
    })

    it("asks everyone to re-send after a hibernation wiped its memory", async () => {
      const board = newBoardId()
      const a = await join(board, "editor")
      a.sendPresence(111, { here: true })
      const witness = await join(board, "owner")
      await until(() => witness.presenceOf(111) !== undefined, "the witness to see A")

      await evictDurableObject(env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(board)))
      const late = await join(board, "viewer")
      await until(() => a.queries > 0, "A to be asked for its presence")
      // A answers the way y-protocols does: its state again, with a newer clock.
      a.sendPresence(111, { here: true }, 2)
      await until(() => late.presenceOf(111) !== undefined, "the joiner to see A")
      a.close()
      witness.close()
      late.close()
    })

    it("ignores presence that isn't a JSON object or is too big", async () => {
      const board = newBoardId()
      const a = await join(board, "editor")
      const b = await join(board, "owner")
      a.sendPresence(111, "just a string")
      a.sendPresence(111, { big: "x".repeat(10_000) }, 2)
      a.sendPresence(111, { ok: true }, 3)
      await until(() => b.presenceOf(111) !== undefined, "B to see A's valid presence")
      expect(b.presence.filter((e) => e.clientId === 111)).toHaveLength(1)
      a.close()
      b.close()
    })
  })
})
