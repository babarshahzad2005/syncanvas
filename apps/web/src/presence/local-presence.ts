import { IDLE_AWAY_MS, tabIsAway } from "./model"

// What this tab publishes about itself (M2 ticket 03): its cursor at about 30 Hz, and whether
// it's away (hidden, or no input for a minute). Other tickets add their own fields through the
// same `publish`.

/** About 30 updates per second (PRD A3). */
const CURSOR_INTERVAL_MS = 33

type Point = { x: number; y: number }

export class LocalPresence {
  private lastSent = 0
  private pending: Point | null | undefined = undefined
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private lastInputAt = Date.now()
  private viewKey = ""
  private viewTimer: ReturnType<typeof setTimeout> | null = null
  private pendingView: { x: number; y: number; w: number; h: number } | null = null
  private lastViewSent = 0
  private away = false
  private readonly publish: (fields: Record<string, unknown>) => void

  constructor(publish: (fields: Record<string, unknown>) => void) {
    this.publish = publish
  }

  start() {
    document.addEventListener("visibilitychange", this.check)
    window.addEventListener("keydown", this.activity)
    window.addEventListener("pointerdown", this.activity)
    window.addEventListener("wheel", this.activity, { passive: true })
    this.activity()
  }

  stop() {
    document.removeEventListener("visibilitychange", this.check)
    window.removeEventListener("keydown", this.activity)
    window.removeEventListener("pointerdown", this.activity)
    window.removeEventListener("wheel", this.activity)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.viewTimer) clearTimeout(this.viewTimer)
  }

  /**
   * The part of the Board this tab shows (world units), for anyone following it. Sent at most
   * about 30 times a second, and only when it changes.
   */
  view(rect: { x: number; y: number; w: number; h: number }) {
    const rounded = {
      x: Math.round(rect.x * 100) / 100,
      y: Math.round(rect.y * 100) / 100,
      w: Math.round(rect.w * 100) / 100,
      h: Math.round(rect.h * 100) / 100,
    }
    const key = JSON.stringify(rounded)
    if (key === this.viewKey) return
    this.viewKey = key
    this.pendingView = rounded
    const wait = this.lastViewSent + CURSOR_INTERVAL_MS - performance.now()
    if (wait <= 0) this.flushView()
    else this.viewTimer ??= setTimeout(this.flushView, wait)
  }

  private flushView = () => {
    this.viewTimer = null
    if (!this.pendingView) return
    this.lastViewSent = performance.now()
    this.publish({ view: this.pendingView })
    this.pendingView = null
  }

  /** The pointer moved over the Board (world units), or left it (null). */
  cursor(point: Point | null) {
    this.activity()
    this.pending = point
    const wait = this.lastSent + CURSOR_INTERVAL_MS - performance.now()
    if (wait <= 0) this.flush()
    else this.flushTimer ??= setTimeout(this.flush, wait)
  }

  private flush = () => {
    this.flushTimer = null
    if (this.pending === undefined) return
    this.lastSent = performance.now()
    // An away tab has no cursor; the point is kept for when it's back.
    if (!this.away) this.publish({ cursor: this.pending })
    this.pending = undefined
  }

  /** Any input: not idle any more, and away ends at once. */
  activity = () => {
    this.lastInputAt = Date.now()
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(this.check, IDLE_AWAY_MS)
    this.check()
  }

  private check = () => {
    const away = tabIsAway(document.visibilityState === "hidden", this.lastInputAt, Date.now())
    if (away === this.away) return
    this.away = away
    this.publish(away ? { away: true, cursor: null } : { away: false })
  }
}
