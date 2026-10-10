import { DurableObject } from "cloudflare:workers"
import { validateBoardDoc } from "@syncanvas/board-model"
import { canEdit, type Role } from "@syncanvas/shared"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"
import { type BoardTokenKind, verifyBoardToken } from "./board-token"

// One BoardRoom per Board (ADR 0006): holds the live Yjs doc, checks the Role on every incoming
// update, persists accepted updates to its own SQLite storage, then broadcasts them.

export const MESSAGE_SYNC = 0

/** WebSocket close codes the client acts on. */
export const CLOSE = {
  /** Token missing, forged, or expired: fetch a new one and reconnect. */
  invalidToken: 4401,
  /** No right to this Board, or a read-only socket tried to edit: stop and explain. */
  forbidden: 4403,
  /** The update would make the Board invalid. */
  invalidUpdate: 4400,
} as const

type SocketInfo = { userId: string; role: Role; kind: BoardTokenKind }

function syncMessage(write: (encoder: encoding.Encoder) => void) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

function isEmptyUpdate(update: Uint8Array) {
  const { structs, ds } = Y.decodeUpdate(update)
  return structs.length === 0 && ds.clients.size === 0
}

export class BoardRoom extends DurableObject<Env> {
  private doc = new Y.Doc()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
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
      role: claims.role,
      kind: claims.kind,
    } satisfies SocketInfo)
    // Sync step 1: tell the client what we have, so it sends what we're missing.
    server.send(syncMessage((e) => syncProtocol.writeSyncStep1(e, this.doc)))
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    if (typeof message === "string") return
    const decoder = decoding.createDecoder(new Uint8Array(message))
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return // awareness arrives in M2

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
    if (isEmptyUpdate(update)) return
    const info = ws.deserializeAttachment() as SocketInfo
    if (info.kind !== "member" || !canEdit(info.role)) {
      ws.close(CLOSE.forbidden, "read-only")
      return
    }

    // Validate on a scratch copy first, so invalid content never touches the live doc.
    const scratch = new Y.Doc()
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(this.doc))
    Y.applyUpdate(scratch, update)
    if (validateBoardDoc(scratch).length > 0) {
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

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    // Finish the closing handshake. 1005/1006 mean "no code" / "dropped" and can't be sent back.
    const sendable = code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 && code !== 1015
    try {
      ws.close(sendable ? code : 1000, sendable ? reason : "")
    } catch {
      // Already closed.
    }
  }
}
