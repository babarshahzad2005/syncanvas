import { DurableObject } from "cloudflare:workers"
import { checkUpdate } from "@syncanvas/board-model"
import { canEdit, type Role } from "@syncanvas/shared"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"
import { type BoardTokenKind, verifyBoardToken } from "./board-token"
import {
  decodePresence,
  MESSAGE_AWARENESS,
  type PresenceEntry,
  presenceMessage,
  queryPresenceMessage,
  REMOVED_CLOCK,
  stampPresence,
} from "./presence"

// One BoardRoom per Board (ADR 0006): holds the live Yjs doc, checks the Role on every incoming
// update, persists accepted updates to its own SQLite storage, then broadcasts them. It also
// relays presence (M2): never stored, stamped with each connection's verified identity.

export const MESSAGE_SYNC = 0
export const HEARTBEAT_PING = "ping"
export const HEARTBEAT_PONG = "pong"

/** WebSocket close codes the client acts on. */
export const CLOSE = {
  /** Token missing, forged, or expired: fetch a new one and reconnect. */
  invalidToken: 4401,
  /** No right to this Board, or a read-only socket tried to edit: stop and explain. */
  forbidden: 4403,
  /** The update would make the Board invalid. */
  invalidUpdate: 4400,
} as const

type SocketInfo = {
  userId: string
  name: string
  role: Role
  kind: BoardTokenKind
  /** The one awareness id this connection publishes under, once it has sent presence. */
  presenceId?: number
}

function syncMessage(write: (encoder: encoding.Encoder) => void) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

export class BoardRoom extends DurableObject<Env> {
  private doc = new Y.Doc()
  /**
   * Latest presence per awareness id, stamped, for sending to people who join. Memory only:
   * after a hibernation it starts empty, and the next joiner triggers a query instead.
   */
  private presence = new Map<number, PresenceEntry>()
  private presenceWarm = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Heartbeat (M2 ticket 06): clients send "ping" every 20 s to notice a dead connection.
    // Answered by the runtime itself, so it never wakes the room or costs anything.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG))
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "create table if not exists updates (seq integer primary key autoincrement, data blob not null, at integer not null)",
      )
      for (const row of this.ctx.storage.sql.exec<{ data: ArrayBuffer }>(
        "select data from updates order by seq",
      )) {
        Y.applyUpdate(this.doc, new Uint8Array(row.data))
      }
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 })
    }
    const url = new URL(request.url)
    const boardId = decodeURIComponent(url.pathname.split("/")[2] ?? "")
    const claims = await verifyBoardToken(
      url.searchParams.get("token") ?? "",
      this.env.BOARD_TOKEN_PUBLIC_KEY,
    )

    const { 0: client, 1: server } = new WebSocketPair()

    // Refusals still complete the upgrade, so the browser sees a close code it can act on.
    const refuse = (code: number, reason: string) => {
      server.accept()
      server.close(code, reason)
      return new Response(null, { status: 101, webSocket: client })
    }
    if (!claims) return refuse(CLOSE.invalidToken, "invalid or expired token")
    if (claims.boardId !== boardId) return refuse(CLOSE.forbidden, "token is for another board")

    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({
      userId: claims.userId,
      name: claims.name,
      role: claims.role,
      kind: claims.kind,
    } satisfies SocketInfo)
    // Sync step 1: tell the client what we have, so it sends what we're missing.
    server.send(syncMessage((e) => syncProtocol.writeSyncStep1(e, this.doc)))
    this.greetWithPresence(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    if (typeof message === "string") return
    const decoder = decoding.createDecoder(new Uint8Array(message))
    const type = decoding.readVarUint(decoder)
    if (type === MESSAGE_AWARENESS)
      return this.receivePresence(ws, decoding.readVarUint8Array(decoder))
    if (type !== MESSAGE_SYNC) return

    switch (decoding.readVarUint(decoder)) {
      case syncProtocol.messageYjsSyncStep1: {
        const stateVector = decoding.readVarUint8Array(decoder)
        ws.send(syncMessage((e) => syncProtocol.writeSyncStep2(e, this.doc, stateVector)))
        return
      }
      case syncProtocol.messageYjsSyncStep2:
      case syncProtocol.messageYjsUpdate:
        this.receiveUpdate(ws, decoding.readVarUint8Array(decoder))
        return
    }
  }

  private receiveUpdate(ws: WebSocket, update: Uint8Array) {
    const info = ws.deserializeAttachment() as SocketInfo
    switch (checkUpdate(this.doc, update, info.kind === "member" && canEdit(info.role))) {
      case "unchanged":
      case "incomplete":
        return
      case "read-only":
        ws.close(CLOSE.forbidden, "read-only")
        return
      case "invalid":
        ws.close(CLOSE.invalidUpdate, "invalid update")
        return
    }

    // Persist before broadcasting: an update anyone has seen is always in storage.
    this.ctx.storage.sql.exec("insert into updates (data, at) values (?, ?)", update, Date.now())
    Y.applyUpdate(this.doc, update)

    const outgoing = syncMessage((e) => syncProtocol.writeUpdate(e, update))
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws) other.send(outgoing)
    }
  }

  // ---------- Presence ----------

  /** A new connection sees everyone already here at once (PRD: within 2 s). */
  private greetWithPresence(ws: WebSocket) {
    const info = ws.deserializeAttachment() as SocketInfo
    if (info.kind === "embed") return // Embed viewers see no presence
    const others = this.ctx.getWebSockets().filter((other) => other !== ws)
    if (!this.presenceWarm && others.length > 0) {
      // Memory was wiped (hibernation): ask everyone to re-send; replies reach the joiner too.
      const query = queryPresenceMessage()
      for (const other of others) other.send(query)
    } else {
      const live = new Set(
        others.map((other) => (other.deserializeAttachment() as SocketInfo).presenceId),
      )
      const entries = [...this.presence.values()].filter((entry) => live.has(entry.clientId))
      if (entries.length > 0) ws.send(presenceMessage(entries))
    }
    this.presenceWarm = true
  }

  private receivePresence(ws: WebSocket, update: Uint8Array) {
    const info = ws.deserializeAttachment() as SocketInfo
    if (info.kind === "embed") return // Embed viewers don't publish presence
    let entries: PresenceEntry[]
    try {
      entries = decodePresence(update)
    } catch {
      return
    }
    const accepted: PresenceEntry[] = []
    for (const entry of entries) {
      // Each connection gets exactly one awareness id: the first it uses that nobody else has.
      if (info.presenceId === undefined) {
        if (this.ownerOf(entry.clientId)) continue
        info.presenceId = entry.clientId
        ws.serializeAttachment(info)
      }
      if (entry.clientId !== info.presenceId) continue
      const state = stampPresence(entry.state, {
        id: info.userId,
        name: info.name,
        guest: info.kind === "guest",
      })
      if (state === null) continue
      const stamped = { clientId: entry.clientId, clock: entry.clock, state }
      if (state === "null") this.presence.delete(entry.clientId)
      else this.presence.set(entry.clientId, stamped)
      accepted.push(stamped)
    }
    if (accepted.length > 0) this.broadcastPresence(presenceMessage(accepted), ws)
  }

  private ownerOf(clientId: number): WebSocket | undefined {
    return this.ctx
      .getWebSockets()
      .find((ws) => (ws.deserializeAttachment() as SocketInfo).presenceId === clientId)
  }

  private broadcastPresence(message: Uint8Array, from: WebSocket) {
    for (const other of this.ctx.getWebSockets()) {
      if (other === from) continue
      if ((other.deserializeAttachment() as SocketInfo).kind === "embed") continue
      try {
        other.send(message)
      } catch {
        // A connection we can't send to is gone: drop its presence now, not at close.
        this.removePresence(other)
      }
    }
  }

  /** Someone left: tell everyone else to drop their presence now. */
  private removePresence(ws: WebSocket) {
    const info = ws.deserializeAttachment() as SocketInfo | null
    const clientId = info?.presenceId
    if (clientId === undefined) return
    this.presence.delete(clientId)
    this.broadcastPresence(presenceMessage([{ clientId, clock: REMOVED_CLOCK, state: "null" }]), ws)
  }

  async webSocketError(ws: WebSocket) {
    this.removePresence(ws)
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.removePresence(ws)
    // Finish the closing handshake. 1005/1006 mean "no code" / "dropped" and can't be sent back.
    const sendable = code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 && code !== 1015
    try {
      ws.close(sendable ? code : 1000, sendable ? reason : "")
    } catch {
      // Already closed.
    }
  }
}
