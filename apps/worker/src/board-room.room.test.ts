import { env, evictDurableObject, SELF } from "cloudflare:test"
import { ELEMENT_CAP, elementsOf, TEXT_LIMIT } from "@syncanvas/board-model"
import type { AccessNotice, ControlMessage, Role } from "@syncanvas/shared"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import { describe, expect, it } from "vitest"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"
import {
  CLOSE,
  HEARTBEAT_PING,
  HEARTBEAT_PONG,
  MESSAGE_ACCESS,
  MESSAGE_CONTROL,
  MESSAGE_SYNC,
} from "./board-room"
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
  /** Access notices received (M3). */
  readonly access: AccessNotice[] = []
  /** Comment events received (M4). */
  readonly control: ControlMessage[] = []
  /** Text frames received (the heartbeat's "pong"). */
  readonly texts: string[] = []
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
      const data = e.data as ArrayBuffer | Blob | string
      if (typeof data === "string") {
        client.texts.push(data)
        return
      }
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
    if (type === MESSAGE_ACCESS) {
      this.access.push(JSON.parse(decoding.readVarString(decoder)))
      return
    }
    if (type === MESSAGE_CONTROL) {
      this.control.push(JSON.parse(decoding.readVarString(decoder)))
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
  extra: { kind?: BoardTokenKind; now?: number; userId?: string } = {},
) {
  const signed = await signBoardToken(
    {
      userId: extra.userId ?? `user-${role}`,
      name: `User ${role}`,
      boardId,
      role,
      kind: extra.kind ?? "member",
    },
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

  it("answers the heartbeat ping", async () => {
    const board = newBoardId()
    const a = await join(board, "viewer")
    a.ws.send(HEARTBEAT_PING)
    await until(() => a.texts.includes(HEARTBEAT_PONG), "a pong")
    a.close()
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

// ---------- Access changes (M3 ticket 02, S7) ----------

function room(boardId: string) {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId))
}

async function joinAs(boardId: string, role: Role, userId: string, now?: number) {
  const client = await TestClient.connect(boardId, await token(boardId, role, { userId, now }))
  await until(() => client.synced || client.closed !== null, `${userId} to sync`)
  return client
}

describe("BoardRoom access changes", () => {
  it("downgrades a live socket: told at once, and its next update is refused", async () => {
    const board = newBoardId()
    const owner = await joinAs(board, "owner", "ada")
    const grace = await joinAs(board, "editor", "grace")
    const graceTab2 = await joinAs(board, "editor", "grace")
    grace.addRect("before")
    await until(() => owner.rect("before") !== undefined, "the edit before the change")

    await room(board).applyAccess({ userId: "grace", role: "viewer", by: "Ada" })
    await until(() => grace.access.length > 0 && graceTab2.access.length > 0, "the notice")
    expect(grace.access).toEqual([{ role: "viewer", by: "Ada" }])
    expect(owner.access).toEqual([])

    grace.addRect("after")
    await until(() => grace.closed !== null, "grace's socket to close")
    expect(grace.closed).toEqual({ code: CLOSE.forbidden, reason: "read-only" })
    await new Promise((r) => setTimeout(r, 200))
    expect(owner.rect("after")).toBeUndefined()
    expect(graceTab2.closed).toBeNull()
    owner.close()
    graceTab2.close()
  })

  it("upgrades a live socket: its edits are accepted from then on", async () => {
    const board = newBoardId()
    const owner = await joinAs(board, "owner", "ada")
    const grace = await joinAs(board, "viewer", "grace")
    await room(board).applyAccess({ userId: "grace", role: "editor", by: "Ada" })
    await until(() => grace.access.length > 0, "the notice")
    grace.addRect("now-allowed")
    await until(() => owner.rect("now-allowed") !== undefined, "the owner to see the edit")
    expect(grace.closed).toBeNull()
    owner.close()
    grace.close()
  })

  it("closes a removed User's sockets with forbidden, after telling them", async () => {
    const board = newBoardId()
    const owner = await joinAs(board, "owner", "ada")
    const grace = await joinAs(board, "editor", "grace")
    grace.sendPresence(77, { cursor: { x: 1, y: 2 } })
    await until(() => owner.presenceOf(77) !== undefined, "grace's presence")

    await room(board).applyAccess({ userId: "grace", role: null, by: "Ada" })
    await until(() => grace.closed !== null, "grace's socket to close")
    expect(grace.access).toEqual([{ role: null, by: "Ada" }])
    expect(grace.closed).toEqual({ code: CLOSE.forbidden, reason: "removed" })
    await until(() => owner.presenceOf(77) === null, "grace to leave the owner's presence")
    expect(owner.closed).toBeNull()
    owner.close()
  })

  it("never lets a token from before the change undo it", async () => {
    const board = newBoardId()
    const owner = await joinAs(board, "owner", "ada")
    const before = Date.now() - 2_000
    await room(board).applyAccess({ userId: "grace", role: "viewer", by: "Ada" })

    // An Editor token issued before the downgrade only gets Viewer rights.
    const stale = await joinAs(board, "editor", "grace", before)
    stale.addRect("stale")
    await until(() => stale.closed !== null, "the stale socket to close")
    expect(stale.closed?.reason).toBe("read-only")

    // A token issued after it carries the Role the API saw.
    const fresh = await joinAs(board, "editor", "grace", Date.now() + 2_000)
    fresh.addRect("fresh")
    await until(() => owner.rect("fresh") !== undefined, "the fresh token's edit")
    fresh.close()

    // Removed: an older token can't get back in at all.
    await room(board).applyAccess({ userId: "linus", role: null, by: "Ada" })
    const gone = await TestClient.connect(
      board,
      await token(board, "editor", { userId: "linus", now: before }),
    )
    await until(() => gone.closed !== null, "the removed User's socket to close")
    expect(gone.closed).toEqual({ code: CLOSE.forbidden, reason: "removed" })
    expect(owner.rect("stale")).toBeUndefined()
    owner.close()
  })
})

// ---------- Guests and the connection cap (M3 ticket 04) ----------

async function joinGuest(boardId: string, id: string, now?: number) {
  const client = await TestClient.connect(
    boardId,
    await token(boardId, "viewer", { kind: "guest", userId: id, now }),
  )
  await until(() => client.synced || client.closed !== null, `${id} to sync`)
  return client
}

/** The name the board room stamped on an awareness id's presence. */
function stampedName(observer: TestClient, clientId: number) {
  return (observer.presenceOf(clientId)?.user as { name: string; guest: boolean } | undefined)?.name
}

describe("BoardRoom Guests and cap", () => {
  it("numbers Guests per Board, reusing the lowest free number", async () => {
    const board = newBoardId()
    const owner = await joinAs(board, "owner", "ada")
    const first = await joinGuest(board, "guest-a")
    const second = await joinGuest(board, "guest-b")
    first.sendPresence(11, {})
    second.sendPresence(12, {})
    await until(() => owner.presenceOf(12) !== undefined, "both guests' presence")
    expect(stampedName(owner, 11)).toBe("Guest 1")
    expect(stampedName(owner, 12)).toBe("Guest 2")
    expect(owner.presenceOf(11)?.user).toMatchObject({ guest: true })

    first.close()
    await until(() => owner.presenceOf(11) === null, "guest 1 to leave")
    const third = await joinGuest(board, "guest-c")
    third.sendPresence(13, {})
    await until(() => owner.presenceOf(13) !== undefined, "the new guest's presence")
    expect(stampedName(owner, 13)).toBe("Guest 1")
    owner.close()
    second.close()
    third.close()
  })

  it("refuses every update from a Guest (S7)", async () => {
    const board = newBoardId()
    const owner = await joinAs(board, "owner", "ada")
    const guest = await joinGuest(board, "guest-a")
    guest.addRect("sneaky")
    await until(() => guest.closed !== null, "the guest to be closed")
    expect(guest.closed).toEqual({ code: CLOSE.forbidden, reason: "read-only" })
    await new Promise((r) => setTimeout(r, 200))
    expect(owner.rect("sneaky")).toBeUndefined()
    owner.close()
  })

  it("at the cap, admits Members and turns Guests away as busy", async () => {
    const board = newBoardId() // the room tests run with a cap of 4
    const members = await Promise.all(["a", "b", "c"].map((id) => joinAs(board, "editor", id)))
    const guest = await joinGuest(board, "guest-a")
    expect(guest.closed).toBeNull() // 4 of 4

    const late = await joinGuest(board, "guest-b")
    expect(late.closed).toEqual({ code: CLOSE.busy, reason: "busy" })
    const member = await joinAs(board, "viewer", "d")
    expect(member.closed).toBeNull()
    expect(member.synced).toBe(true)

    // Room again: the next Guest gets in.
    for (const m of [...members, member]) m.close()
    await new Promise((r) => setTimeout(r, 200))
    const again = await joinGuest(board, "guest-c")
    expect(again.closed).toBeNull()
    guest.close()
    again.close()
  })

  it("closes every Guest when the link goes off, and refuses their old tokens", async () => {
    const board = newBoardId()
    const owner = await joinAs(board, "owner", "ada")
    const before = Date.now() - 2_000
    const guest = await joinGuest(board, "guest-a")
    await room(board).closeGuests()
    await until(() => guest.closed !== null, "the guest to be closed")
    expect(guest.closed).toEqual({ code: CLOSE.forbidden, reason: "link off" })
    expect(owner.closed).toBeNull()

    const stale = await joinGuest(board, "guest-b", before)
    expect(stale.closed).toEqual({ code: CLOSE.forbidden, reason: "removed" })
    const fresh = await joinGuest(board, "guest-c", Date.now() + 2_000)
    expect(fresh.closed).toBeNull()
    owner.close()
    fresh.close()
  })
})

// ---------- S7: every write path is refused for read-only connections (M3 ticket 05) ----------

/** A sync message as a client would send it. */
function rawSync(write: (e: encoding.Encoder) => void) {
  const e = encoding.createEncoder()
  encoding.writeVarUint(e, MESSAGE_SYNC)
  write(e)
  return encoding.toUint8Array(e)
}

/** A doc holding one rectangle, standing in for a client's own content. */
function docWithRect(id: string) {
  const doc = new Y.Doc()
  const m = new Y.Map<unknown>()
  for (const [k, v] of Object.entries({
    type: "rect",
    position: { x: 1, y: 2 },
    size: { w: 30, h: 40 },
    z: "a0",
    color: "ink",
  }))
    m.set(k, v)
  elementsOf(doc).set(id, m)
  return doc
}

describe("S7: read-only connections can't write", () => {
  const readOnly = [
    ["Viewer", (board: string) => joinAs(board, "viewer", "vi")],
    ["Commenter", (board: string) => joinAs(board, "commenter", "co")],
    ["Guest", (board: string) => joinGuest(board, "guest-s7")],
  ] as const
  const paths = [
    [
      "a sync update",
      (doc: Y.Doc) => rawSync((e) => syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc))),
    ],
    ["a step-2 reply", (doc: Y.Doc) => rawSync((e) => syncProtocol.writeSyncStep2(e, doc))],
  ] as const

  for (const [who, connect] of readOnly) {
    for (const [path, message] of paths) {
      it(`refuses ${path} from a ${who}: closed, nothing stored or broadcast`, async () => {
        const board = newBoardId()
        const owner = await joinAs(board, "owner", "ada")
        const client = await connect(board)
        client.ws.send(message(docWithRect("sneaky")))
        await until(() => client.closed !== null, `the ${who} to be closed`)
        expect(client.closed).toEqual({ code: CLOSE.forbidden, reason: "read-only" })
        await new Promise((r) => setTimeout(r, 200))
        expect(owner.rect("sneaky")).toBeUndefined()
        owner.close()
        const late = await joinAs(board, "editor", "late")
        expect(late.rect("sneaky")).toBeUndefined()
        late.close()
      })
    }
  }

  it("never lets presence write the document", async () => {
    const board = newBoardId()
    const owner = await joinAs(board, "owner", "ada")
    const viewer = await joinAs(board, "viewer", "vi")
    // Presence that tries to smuggle a document update, or claims to be someone else.
    const update = Array.from(Y.encodeStateAsUpdate(docWithRect("via-presence")))
    viewer.sendPresence(21, { update, elements: { r: { type: "rect" } }, user: { id: "ada" } })
    await until(() => owner.presenceOf(21) !== undefined, "the presence to arrive")
    expect(owner.presenceOf(21)?.user).toMatchObject({ id: "vi", guest: false })
    expect(viewer.closed).toBeNull()
    owner.close()
    viewer.close()
    const late = await joinAs(board, "editor", "late")
    expect(late.rect("via-presence")).toBeUndefined()
    expect(elementsOf(late.doc).size).toBe(0)
    late.close()
  })
})

// ---------- Comments (M4 ticket 01) ----------

describe("BoardRoom comment events", () => {
  it("relays a comment change to Members and Guests, never to Embed viewers", async () => {
    const board = newBoardId()
    const owner = await joinAs(board, "owner", "ada")
    const viewer = await joinAs(board, "viewer", "vi")
    const guest = await joinGuest(board, "guest-a")
    const embed = await TestClient.connect(
      board,
      await token(board, "viewer", { kind: "embed", userId: "embed-1" }),
    )
    await until(() => embed.synced, "the embed to sync")

    const message: ControlMessage = {
      type: "thread-added",
      thread: {
        id: "t1",
        boardId: board,
        anchor: { x: 1, y: 2 },
        last: null,
        status: "open",
        createdAt: new Date(0).toISOString(),
        comments: [],
      },
    }
    await room(board).control(message)
    await until(
      () => [owner, viewer, guest].every((c) => c.control.length === 1),
      "everyone but the embed to hear it",
    )
    expect(owner.control).toEqual([message])
    await new Promise((r) => setTimeout(r, 200))
    expect(embed.control).toEqual([])
    for (const c of [owner, viewer, guest, embed]) c.close()
  })
})
