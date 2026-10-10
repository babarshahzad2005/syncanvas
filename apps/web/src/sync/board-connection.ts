import { type BoardTokenResponse, canEdit } from "@syncanvas/shared"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import * as syncProtocol from "y-protocols/sync"
import type * as Y from "yjs"
import { ApiError, api } from "@/lib/api"

// Keeps one Board's Y.Doc in sync with its board room (FLOWS §2 "Open a Board"):
// fetch a short-lived board token, open /ws/{boardId}, run Yjs sync steps 1 and 2 both ways,
// then stream updates. Reconnects with exponential backoff and full jitter.

export type ConnectionStatus = "connecting" | "online" | "offline" | "revoked"

const MESSAGE_SYNC = 0
/** Must match CLOSE in the Worker's board-room.ts. */
const CLOSE_INVALID_TOKEN = 4401
const CLOSE_FORBIDDEN = 4403

/** Full jitter: a random wait between 0 and min(cap, base·2^attempt). */
export function backoffDelay(attempt: number, random = Math.random, base = 500, cap = 15_000) {
  return Math.floor(random() * Math.min(cap, base * 2 ** attempt))
}

export class BoardConnection {
  status: ConnectionStatus = "connecting"
  board: BoardTokenResponse["board"] | null = null
  role: BoardTokenResponse["role"] | null = null

  private ws: WebSocket | null = null
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private listeners = new Set<() => void>()

  readonly boardId: string
  readonly doc: Y.Doc

  constructor(boardId: string, doc: Y.Doc) {
    this.boardId = boardId
    this.doc = doc
    doc.on("update", this.onLocalUpdate)
  }

  /** For React: subscribe to status/board changes. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start() {
    this.stopped = false
    window.addEventListener("offline", this.onBrowserOffline)
    window.addEventListener("online", this.onBrowserOnline)
    void this.connect()
  }

  stop() {
    this.stopped = true
    window.removeEventListener("offline", this.onBrowserOffline)
    window.removeEventListener("online", this.onBrowserOnline)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.ws?.close(1000, "left the board")
    this.ws = null
    this.doc.off("update", this.onLocalUpdate)
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status
    for (const l of this.listeners) l()
  }

  private async connect() {
    if (this.stopped) return
    this.setStatus(this.attempt === 0 ? "connecting" : "offline")

    let pass: BoardTokenResponse
    try {
      // A fresh token for every connection attempt, so an expired one is never reused.
      pass = await api.boardToken(this.boardId)
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) return this.setStatus("revoked")
      if (error instanceof ApiError && error.status === 401) {
        window.location.assign(`/sign-in?redirect=${encodeURIComponent(location.pathname)}`)
        return
      }
      return this.scheduleRetry()
    }
    if (this.stopped) return
    this.board = pass.board
    this.role = pass.role

    const scheme = location.protocol === "https:" ? "wss:" : "ws:"
    const ws = new WebSocket(
      `${scheme}//${location.host}/ws/${encodeURIComponent(this.boardId)}?token=${encodeURIComponent(pass.token)}`,
    )
    ws.binaryType = "arraybuffer"
    this.ws = ws

    ws.addEventListener("open", () => {
      this.send((e) => syncProtocol.writeSyncStep1(e, this.doc))
    })
    ws.addEventListener("message", (event) => this.onMessage(event.data as ArrayBuffer))
    ws.addEventListener("close", (event) => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.stopped) return
      if (event.code === CLOSE_FORBIDDEN) return this.setStatus("revoked")
      if (event.code === CLOSE_INVALID_TOKEN) {
        // The token expired between fetch and connect; try again straight away.
        this.attempt = 0
        return void this.connect()
      }
      this.scheduleRetry()
    })
  }

  /** The browser knows the network is gone: don't wait for the socket to time out. */
  private onBrowserOffline = () => {
    const ws = this.ws
    this.ws = null
    ws?.close(1000, "browser offline")
    this.scheduleRetry()
  }

  /** The network is back: reconnect now instead of waiting out the backoff. */
  private onBrowserOnline = () => {
    if (this.stopped || this.ws || this.status === "revoked") return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.attempt = 0
    void this.connect()
  }

  private scheduleRetry() {
    if (this.stopped) return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.setStatus("offline")
    const delay = backoffDelay(this.attempt++)
    this.retryTimer = setTimeout(() => void this.connect(), delay)
  }

  private send(write: (e: encoding.Encoder) => void) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
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
    if (encoding.length(reply) > 1) this.ws?.send(encoding.toUint8Array(reply))
    if (type === syncProtocol.messageYjsSyncStep2) {
      this.attempt = 0
      this.setStatus("online")
    }
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return // came from the room; don't echo it back
    if (this.role && !canEdit(this.role)) return // read-only: nothing of ours to send
    this.send((e) => syncProtocol.writeUpdate(e, update))
  }
}
