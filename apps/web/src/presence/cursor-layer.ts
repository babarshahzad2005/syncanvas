import { type Camera, worldToScreen } from "@syncanvas/renderer"
import { PerfectCursor } from "perfect-cursors"
import { cursorOf, presenceColor, type TabPresence } from "./model"

// Remote cursors (DESIGN.md → Canvas → Cursors): a 16px arrow in the presence color with a
// 1.5px white outline, and a name label that fades after 3 s without movement. Positions are
// world units smoothed with perfect-cursors, then placed with the local camera, so cursors
// stay put on the Board while you pan or zoom. Plain DOM, updated directly: 30 Hz cursors
// never re-render React.

const LABEL_FADE_MS = 3000
/**
 * perfect-cursors ends its last animation just before the final point, so a resting cursor
 * would sit a few pixels short. Once points stop arriving, settle exactly on the last one.
 */
const SETTLE_MS = PerfectCursor.MAX_INTERVAL + 50
const SVG = "http://www.w3.org/2000/svg"

type Cursor = {
  root: HTMLDivElement
  label: HTMLSpanElement
  arrow: SVGPathElement
  smoother: PerfectCursor
  /** The smoothed world position, or null while hidden. */
  at: { x: number; y: number } | null
  target: string
  fade: ReturnType<typeof setTimeout> | null
  settle: ReturnType<typeof setTimeout> | null
}

export class CursorLayer {
  private cursors = new Map<number, Cursor>()
  private camera: Camera = { x: 0, y: 0, zoom: 1 }
  private readonly host: HTMLElement

  constructor(host: HTMLElement) {
    this.host = host
  }

  /** Every other tab's presence (including your own other tabs). */
  update(tabs: readonly TabPresence[]) {
    const seen = new Set<number>()
    for (const tab of tabs) {
      seen.add(tab.clientId)
      const point = cursorOf(tab)
      let cursor = this.cursors.get(tab.clientId)
      if (!point) {
        if (cursor) this.hide(cursor)
        continue
      }
      if (!cursor) cursor = this.create(tab.clientId)
      const color = presenceColor(tab.user.id, tab.user.guest)
      cursor.arrow.setAttribute("fill", color)
      cursor.label.style.background = color
      cursor.label.textContent = tab.user.name
      cursor.root.dataset.cursor = tab.user.name
      const target = `${point.x},${point.y}`
      if (target === cursor.target) continue
      cursor.target = target
      if (!cursor.at) {
        // Appearing: start right there, no glide in from where it was hidden.
        cursor.at = point
        cursor.root.hidden = false
        this.place(cursor)
      }
      cursor.smoother.addPoint([point.x, point.y])
      const resting = cursor
      if (resting.settle) clearTimeout(resting.settle)
      resting.settle = setTimeout(() => {
        if (!resting.at) return
        resting.at = point
        this.place(resting)
      }, SETTLE_MS)
      this.showLabel(cursor)
    }
    for (const [clientId, cursor] of this.cursors) {
      if (!seen.has(clientId)) this.remove(clientId, cursor)
    }
  }

  setCamera(camera: Camera) {
    this.camera = camera
    for (const cursor of this.cursors.values()) this.place(cursor)
  }

  dispose() {
    for (const [clientId, cursor] of this.cursors) this.remove(clientId, cursor)
  }

  private create(clientId: number): Cursor {
    const root = document.createElement("div")
    // Sized like the arrow, so the cursor has a real box (its top-left is the tip).
    root.className = "pointer-events-none absolute top-0 left-0 size-4 will-change-transform"
    root.setAttribute("aria-hidden", "true")
    const svg = document.createElementNS(SVG, "svg")
    svg.setAttribute("width", "16")
    svg.setAttribute("height", "16")
    svg.setAttribute("viewBox", "0 0 16 16")
    svg.setAttribute("class", "absolute -top-px -left-px overflow-visible")
    const arrow = document.createElementNS(SVG, "path")
    arrow.setAttribute("d", "M1 1 L1 13.5 L4.6 10.2 L7.2 15.5 L9.6 14.4 L7 9.3 L12 9.3 Z")
    arrow.setAttribute("stroke", "#FFFFFF")
    arrow.setAttribute("stroke-width", "1.5")
    arrow.setAttribute("stroke-linejoin", "round")
    svg.append(arrow)
    const label = document.createElement("span")
    label.className =
      "type-label absolute top-4 left-3 rounded-full px-1.5 py-0.5 whitespace-nowrap text-white transition-opacity duration-(--duration-panel) ease-out"
    root.append(svg, label)
    this.host.append(root)
    const cursor: Cursor = {
      root,
      label,
      arrow,
      at: null,
      target: "",
      fade: null,
      settle: null,
      smoother: new PerfectCursor(([x = 0, y = 0]) => {
        if (!cursor.at) return
        cursor.at = { x, y }
        this.place(cursor)
      }),
    }
    this.cursors.set(clientId, cursor)
    return cursor
  }

  private place(cursor: Cursor) {
    if (!cursor.at) return
    const p = worldToScreen(this.camera, cursor.at)
    cursor.root.style.transform = `translate(${p.x}px, ${p.y}px)`
  }

  private showLabel(cursor: Cursor) {
    cursor.label.style.opacity = "1"
    if (cursor.fade) clearTimeout(cursor.fade)
    cursor.fade = setTimeout(() => {
      cursor.label.style.opacity = "0"
    }, LABEL_FADE_MS)
  }

  private hide(cursor: Cursor) {
    cursor.at = null
    cursor.target = ""
    cursor.root.hidden = true
  }

  private remove(clientId: number, cursor: Cursor) {
    cursor.smoother.dispose()
    if (cursor.fade) clearTimeout(cursor.fade)
    if (cursor.settle) clearTimeout(cursor.settle)
    cursor.root.remove()
    this.cursors.delete(clientId)
  }
}
