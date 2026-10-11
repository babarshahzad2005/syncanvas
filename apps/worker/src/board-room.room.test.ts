import { env, evictDurableObject, SELF } from "cloudflare:test"
import { ELEMENT_CAP, elementsOf } from "@syncanvas/board-model"
import type { Role } from "@syncanvas/shared"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import { describe, expect, it } from "vitest"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"
import { CLOSE, MESSAGE_SYNC } from "./board-room"
import { type BoardTokenKind, signBoardToken } from "./board-token"

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
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return
    const reply = encoding.createEncoder()
    encoding.writeVarUint(reply, MESSAGE_SYNC)
    const type = syncProtocol.readSyncMessage(decoder, reply, this.doc, this)
    if (encoding.length(reply) > 1) this.ws.send(encoding.toUint8Array(reply))
    if (type === syncProtocol.messageYjsSyncStep2) this.synced = true
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
    { userId: `user-${role}`, boardId, role, kind: extra.kind ?? "member" },
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
})
