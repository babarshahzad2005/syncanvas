import {
  type AccessNotice,
  type BoardTokenResponse,
  canEdit,
  type InviteRole,
} from "@syncanvas/shared"
import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"
import * as awarenessProtocol from "y-protocols/awareness"
import * as syncProtocol from "y-protocols/sync"
import * as Y from "yjs"
import { ApiError, api } from "@/lib/api"
import { type TabPresence, tabPresence } from "@/presence/model"

// Keeps one Board's Y.Doc in sync with its board room (FLOWS §2 "Open a Board"):
// fetch a short-lived board token, open /ws/{boardId}, run Yjs sync steps 1 and 2 both ways,
// then stream updates. Reconnects with exponential backoff and full jitter.
//
// Presence (M2) rides the same socket as y-protocols awareness. Every connection gets a fresh
// awareness (a new id), so when the board room announces someone left, nothing they publish
// after reconnecting can be mistaken for the old, removed state.

/**
 * "revoked": no access (anymore). "resync": the board room refused an edit this copy made
 * after a downgrade, so the local copy has to be thrown away and loaded fresh.
 */
export type ConnectionStatus =
  | "connecting"
  | "online"
  | "offline"
  | "revoked"
  | "resync"
  /** The Board is full and this isn't a Member: it tries again every 30 s (M3 ticket 04). */
  | "busy"

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const MESSAGE_QUERY_AWARENESS = 3
/** Must match MESSAGE_ACCESS in the Worker's board-room.ts. */
const MESSAGE_ACCESS = 4

/**
 * Heartbeat (M2 ticket 06): a socket can die without the browser noticing (sleep, a flaky
 * network). Every 20 s the client pings; the board room's runtime answers "pong" without
 * waking up. Hearing nothing at all for 30 s means the socket is dead: reconnect.
 */
export const HEARTBEAT = { pingEvery: 20_000, deadAfter: 30_000 }

declare global {
  interface Window {
    /** Test hook: shorter heartbeat timings, read when a connection is created. */
    __SYNCANVAS_HEARTBEAT__?: { pingEvery: number; deadAfter: number }
  }
}
/** Must match CLOSE in the Worker's board-room.ts. */
const CLOSE_INVALID_TOKEN = 4401
const CLOSE_FORBIDDEN = 4403
const CLOSE_BUSY = 4429
/** How long a turned-away Guest waits before trying again (PRD A4). */
export const BUSY_RETRY_MS = 30_000

/** Full jitter: a random wait between 0 and min(cap, base·2^attempt). */
export function backoffDelay(attempt: number, random = Math.random, base = 500, cap = 15_000) {
  return Math.floor(random() * Math.min(cap, base * 2 ** attempt))
}

export class BoardConnection {
  status: ConnectionStatus = "connecting"
  board: BoardTokenResponse["board"] | null = null
  role: BoardTokenResponse["role"] | null = null
  /** Who this connection is, as the board room vouches for it. */
  you: BoardTokenResponse["you"] | null = null
  /** Every other open tab on the Board (including your own other tabs), live. */
  presence: TabPresence[] = []
  /** The last access change the board room announced for you (M3 ticket 02). */
  notice: AccessNotice | null = null
  /** For a Guest: what the Share Link grants once they sign in (M3 ticket 04). */
  linkRole: InviteRole | null = null

  private ws: WebSocket | null = null
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private listeners = new Set<() => void>()
  private presenceListeners = new Set<() => void>()
  private accessListeners = new Set<(notice: AccessNotice) => void>()
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private lastHeard = 0
  private lastPing = 0
  private readonly timing =
    (typeof window !== "undefined" && window.__SYNCANVAS_HEARTBEAT__) || HEARTBEAT
  private awareness: awarenessProtocol.Awareness | null = null
  /** What this tab publishes; kept across reconnects. */
  private localPresence: Record<string, unknown> = {}

  readonly boardId: string
  readonly doc: Y.Doc
  /** A Share Link token: connect as a Guest instead of a Member (M3 ticket 04). */
  readonly guestLink: string | null

  constructor(boardId: string, doc: Y.Doc, options: { guestLink?: string } = {}) {
    this.boardId = boardId
    this.doc = doc
    this.guestLink = options.guestLink ?? null
    doc.on("update", this.onLocalUpdate)
  }

  /** For React: subscribe to status/board changes. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Subscribe to presence changes (others joining, leaving, or updating). */
  subscribePresence = (listener: () => void) => {
    this.presenceListeners.add(listener)
    return () => this.presenceListeners.delete(listener)
  }

  /** Called with each access change the board room announces for you. */
  subscribeAccess = (listener: (notice: AccessNotice) => void) => {
    this.accessListeners.add(listener)
    return () => {
      this.accessListeners.delete(listener)
    }
  }

  /** Merges fields into what this tab publishes (sent at once if connected). */
  setPresence(fields: Record<string, unknown>) {
    this.localPresence = { ...this.localPresence, ...fields }
    this.awareness?.setLocalState(this.localPresence)
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
    this.stopHeartbeat()
    this.endPresence()
    this.doc.off("update", this.onLocalUpdate)
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status
    for (const l of this.listeners) l()
  }

  private async connect() {
    if (this.stopped) return
    // A busy Board keeps saying so until we're in.
    if (this.status !== "busy") this.setStatus(this.attempt === 0 ? "connecting" : "offline")

    let pass: BoardTokenResponse
    try {
      // A fresh token for every connection attempt, so an expired one is never reused.
      if (this.guestLink) {
        const guest = await api.guestToken(this.boardId, this.guestLink)
        this.linkRole = guest.linkRole
        pass = guest
      } else {
        pass = await api.boardToken(this.boardId)
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) return this.setStatus("revoked")
      if (error instanceof ApiError && error.status === 401) {
        window.location.assign(
          `/sign-in?redirect=${encodeURIComponent(location.pathname + location.search)}`,
        )
        return
      }
      return this.scheduleRetry()
    }
    if (this.stopped) return
    this.board = pass.board
    this.role = pass.role
    this.you = pass.you

    const scheme = location.protocol === "https:" ? "wss:" : "ws:"
    const ws = new WebSocket(
      `${scheme}//${location.host}/ws/${encodeURIComponent(this.boardId)}?token=${encodeURIComponent(pass.token)}`,
    )
    ws.binaryType = "arraybuffer"
    this.ws = ws

    ws.addEventListener("open", () => {
      this.startHeartbeat(ws)
      this.send((e) => syncProtocol.writeSyncStep1(e, this.doc))
      // Before sync finishes: the board room sends who's here right away.
      this.startPresence()
    })
    ws.addEventListener("message", (event) => {
      this.lastHeard = performance.now()
      if (typeof event.data === "string") return // the heartbeat's "pong"
      this.onMessage(event.data as ArrayBuffer)
    })
    ws.addEventListener("close", (event) => {
      if (this.ws !== ws) return
      this.ws = null
      this.stopHeartbeat()
      this.endPresence()
      if (this.stopped) return
      if (event.code === CLOSE_BUSY) {
        this.setStatus("busy")
        this.attempt = 0
        if (this.retryTimer) clearTimeout(this.retryTimer)
        this.retryTimer = setTimeout(() => void this.connect(), BUSY_RETRY_MS)
        return
      }
      if (event.code === CLOSE_FORBIDDEN) {
        return this.setStatus(event.reason === "read-only" ? "resync" : "revoked")
      }
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
    this.stopHeartbeat()
    this.endPresence()
    ws?.close(1000, "browser offline")
    this.scheduleRetry()
  }

  /** The network is back: reconnect now instead of waiting out the backoff. */
  private onBrowserOnline = () => {
    if (this.stopped || this.ws || this.status === "revoked" || this.status === "resync") return
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.attempt = 0
    void this.connect()
  }

  private startHeartbeat(ws: WebSocket) {
    this.stopHeartbeat()
    this.lastHeard = this.lastPing = performance.now()
    const check = Math.min(this.timing.pingEvery, 5_000)
    this.heartbeat = setInterval(() => {
      if (this.ws !== ws) return this.stopHeartbeat()
      const now = performance.now()
      if (now - this.lastHeard > this.timing.deadAfter) return this.onDeadSocket(ws)
      if (now - this.lastPing >= this.timing.pingEvery) {
        this.lastPing = now
        if (ws.readyState === WebSocket.OPEN) ws.send("ping")
      }
    }, check)
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  /** Nothing heard for too long: the socket is dead even if the browser hasn't noticed. */
  private onDeadSocket(ws: WebSocket) {
    this.ws = null
    this.stopHeartbeat()
    this.endPresence()
    try {
      ws.close(4000, "heartbeat lost")
    } catch {
      // Already closing.
    }
    this.scheduleRetry()
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
    const type = decoding.readVarUint(decoder)
    if (type === MESSAGE_AWARENESS) {
      if (this.awareness) {
        const update = decoding.readVarUint8Array(decoder)
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this)
      }
      return
    }
    if (type === MESSAGE_QUERY_AWARENESS) {
      this.sendPresence() // the board room lost track (hibernation): say who we are again
      return
    }
    if (type === MESSAGE_ACCESS) {
      this.onAccess(JSON.parse(decoding.readVarString(decoder)) as AccessNotice)
      return
    }
    if (type !== MESSAGE_SYNC) return
    const reply = encoding.createEncoder()
    encoding.writeVarUint(reply, MESSAGE_SYNC)
    const syncType = syncProtocol.readSyncMessage(decoder, reply, this.doc, this)
    if (encoding.length(reply) > 1) this.ws?.send(encoding.toUint8Array(reply))
    if (syncType === syncProtocol.messageYjsSyncStep2) {
      this.attempt = 0
      this.setStatus("online")
    }
  }

  /** The Owner changed your Role (the Board follows at once) or removed you (a close follows). */
  private onAccess(notice: AccessNotice) {
    this.notice = notice
    if (notice.role) this.role = notice.role
    for (const l of this.accessListeners) l(notice)
    for (const l of this.listeners) l()
  }

  // ---------- Presence ----------

  /** Live: publish this tab under a fresh awareness id and start hearing everyone else. */
  private startPresence() {
    if (this.awareness) return
    const awareness = new awarenessProtocol.Awareness(new Y.Doc())
    this.awareness = awareness
    awareness.on("update", ({ added, updated, removed }: AwarenessChanges, origin: unknown) => {
      // Our own changes (and the periodic renewal that keeps us from timing out) go out.
      if (origin === "local") this.sendPresence([...added, ...updated, ...removed])
    })
    awareness.on("change", this.refreshPresence)
    awareness.setLocalState(this.localPresence)
  }

  /** Offline or gone: everyone else disappears from this screen until we're back. */
  private endPresence() {
    this.awareness?.destroy()
    this.awareness = null
    this.refreshPresence()
  }

  private sendPresence(clients?: number[]) {
    const awareness = this.awareness
    if (!awareness || this.ws?.readyState !== WebSocket.OPEN) return
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      e,
      awarenessProtocol.encodeAwarenessUpdate(awareness, clients ?? [awareness.clientID]),
    )
    this.ws.send(encoding.toUint8Array(e))
  }

  private refreshPresence = () => {
    const awareness = this.awareness
    const tabs: TabPresence[] = []
    if (awareness) {
      for (const [clientId, state] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue
        const tab = tabPresence(clientId, state)
        if (tab) tabs.push(tab)
      }
    }
    this.presence = tabs
    for (const l of this.presenceListeners) l()
  }

  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return // came from the room; don't echo it back
    if (this.role && !canEdit(this.role)) return // read-only: nothing of ours to send
    this.send((e) => syncProtocol.writeUpdate(e, update))
  }
}

type AwarenessChanges = { added: number[]; updated: number[]; removed: number[] }
