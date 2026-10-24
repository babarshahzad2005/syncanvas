import "@fontsource-variable/geist"
import "./embed.css"
import { elementsOf, listElements, type Point, readElement } from "@syncanvas/board-model"
import {
  boundsOf,
  type Camera,
  clearTextLayoutCache,
  drawScene,
  ElementIndex,
  fitCamera,
  screenToWorld,
  type Theme,
  zoomAt,
} from "@syncanvas/renderer"
import * as Y from "yjs"
import { imageCache } from "@/board/image-cache"
import { ApiError, api } from "@/lib/api"
import { BUSY_PICTURE_REFRESH_MS, fetchBoardPicture } from "@/lib/busy-picture"
import { BoardConnection } from "@/sync/board-connection"

// The Embed viewer (M6 ticket 06; DESIGN.md → Embed viewer, PRD A8): a Board shown live and
// read-only on another website. Plain TypeScript (no React, comments, or dashboard), the
// shared renderer, and the app's connection with the Embed's token. It never sends anything
// to the Board: the board room refuses Embed edits anyway, and nobody sees Embed viewers.

/** Space around the Board when it's fitted to the frame (DESIGN.md). */
const FIT_PADDING = 24
const WHEEL_ZOOM = 0.01

const token = decodeURIComponent(location.pathname.replace(/^\/embed\//, "").split("/")[0] ?? "")
const theme: Theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light"
if (theme === "dark") document.documentElement.classList.add("dark")

const canvas = document.getElementById("board") as HTMLCanvasElement
const message = document.getElementById("message") as HTMLParagraphElement
const badge = document.getElementById("badge") as HTMLAnchorElement
const picture = document.getElementById("picture") as HTMLImageElement
const caption = document.getElementById("caption") as HTMLParagraphElement
badge.href = location.origin

function show(text: string | null) {
  message.hidden = text === null
  message.textContent = text ?? ""
  canvas.style.visibility = text === null ? "visible" : "hidden"
}

const GONE = "This embed is no longer available."

// ---------- Drawing ----------

const index = new ElementIndex()
let camera: Camera = { x: 0, y: 0, zoom: 1 }
let size = { w: 0, h: 0 }
let dpr = 1
/** The view follows the whole Board until the viewer pans or zooms it themselves. */
let fitted = true
let frame = 0

function fit() {
  if (!fitted || size.w === 0) return
  camera = fitCamera(boundsOf(index.all(), index.byId), size, FIT_PADDING)
}

function render() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const topLeft = screenToWorld(camera, { x: 0, y: 0 })
    const margin = 16 / camera.zoom
    const animating = drawScene(ctx, {
      elements: index.query({
        x: topLeft.x - margin,
        y: topLeft.y - margin,
        w: size.w / camera.zoom + margin * 2,
        h: size.h / camera.zoom + margin * 2,
      }),
      byId: index.byId,
      camera,
      theme,
      size,
      dpr,
      selection: new Set(),
      showGrid: false,
      images: imageCache.get,
      time: performance.now(),
    })
    if (animating) render()
  })
}

new ResizeObserver(() => {
  const box = canvas.getBoundingClientRect()
  dpr = window.devicePixelRatio || 1
  size = { w: box.width, h: box.height }
  canvas.width = Math.round(box.width * dpr)
  canvas.height = Math.round(box.height * dpr)
  fit()
  render()
}).observe(canvas)

imageCache.subscribe(render)

// Text is measured with Geist; once the web font is in, measure again.
void document.fonts.load('400 20px "Geist Variable"').then(() => {
  clearTextLayoutCache()
  index.reset(index.all())
  fit()
  render()
})

// ---------- Pan and zoom (nothing can be selected) ----------

const pointers = new Map<number, Point>()
let drag: { start: Point; camera: Camera } | null = null
let pinch: { distance: number; center: Point; camera: Camera } | null = null

const local = (e: { clientX: number; clientY: number }): Point => {
  const box = canvas.getBoundingClientRect()
  return { x: e.clientX - box.left, y: e.clientY - box.top }
}

function moveCamera(next: Camera) {
  fitted = false
  camera = next
  render()
}

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId)
  pointers.set(e.pointerId, local(e))
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [Point, Point]
    pinch = {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      camera,
    }
    drag = null
  } else if (pointers.size === 1) {
    drag = { start: local(e), camera }
    canvas.classList.add("panning")
  }
})

canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return
  const point = local(e)
  pointers.set(e.pointerId, point)
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [Point, Point]
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const moved = {
      ...pinch.camera,
      x: pinch.camera.x + center.x - pinch.center.x,
      y: pinch.camera.y + center.y - pinch.center.y,
    }
    moveCamera(zoomAt(moved, center, Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance))
  } else if (drag) {
    moveCamera({
      ...drag.camera,
      x: drag.camera.x + point.x - drag.start.x,
      y: drag.camera.y + point.y - drag.start.y,
    })
  }
})

function release(e: PointerEvent) {
  pointers.delete(e.pointerId)
  if (pointers.size < 2) pinch = null
  if (pointers.size === 0) {
    drag = null
    canvas.classList.remove("panning")
  }
}
canvas.addEventListener("pointerup", release)
canvas.addEventListener("pointercancel", release)

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey)
      moveCamera(zoomAt(camera, local(e), Math.exp(-e.deltaY * WHEEL_ZOOM)))
    else moveCamera({ ...camera, x: camera.x - e.deltaX, y: camera.y - e.deltaY })
  },
  { passive: false },
)

// ---------- Busy (M6 ticket 07) ----------

let busyTimer: ReturnType<typeof setInterval> | null = null

/** A full Board turned this viewer away: its last picture, refreshed while waiting. */
async function showBusy(connection: BoardConnection) {
  const load = async () => {
    const url = connection.token
      ? await fetchBoardPicture(connection.boardId, connection.token)
      : null
    if (connection.status !== "busy") {
      if (url) URL.revokeObjectURL(url)
      return
    }
    if (url) {
      if (picture.src) URL.revokeObjectURL(picture.src)
      picture.src = url
      picture.hidden = false
      caption.hidden = false
      show(null)
      canvas.style.visibility = "hidden"
    } else if (picture.hidden) {
      show("This board is busy right now. Retrying…")
    }
  }
  if (!busyTimer) busyTimer = setInterval(() => void load(), BUSY_PICTURE_REFRESH_MS)
  await load()
}

function hideBusy() {
  if (busyTimer) clearInterval(busyTimer)
  busyTimer = null
  if (picture.src) URL.revokeObjectURL(picture.src)
  picture.removeAttribute("src")
  picture.hidden = true
  caption.hidden = true
}

// ---------- The live Board ----------

async function start() {
  if (!token) return show(GONE)
  let boardId: string
  try {
    const pass = await api.embedToken(token)
    boardId = pass.board.id
    document.title = `${pass.board.title} · Syncanvas`
  } catch (error) {
    // Off, renewed, or never existed (403); anything else is worth another try later.
    if (error instanceof ApiError && error.status === 403) return show(GONE)
    show("Couldn't load this board. Retrying…")
    setTimeout(() => void start(), 5_000)
    return
  }

  const doc = new Y.Doc()
  const connection = new BoardConnection(boardId, doc, { embedToken: token })
  imageCache.setAuth(async (fresh) => {
    const bearer =
      fresh || !connection.token ? (await api.embedToken(token)).token : connection.token
    return { authorization: `Bearer ${bearer}` }
  })

  const elements = elementsOf(doc)
  index.reset(listElements(doc))
  elements.observeDeep((events) => {
    const changed = new Set<string>()
    for (const event of events) {
      if (event.target === elements) for (const id of event.changes.keys.keys()) changed.add(id)
      else if (typeof event.path[0] === "string") changed.add(event.path[0])
    }
    index.update(
      [...changed].map((id) => {
        const fields = elements.get(id)
        const element = fields ? readElement(fields) : null
        return [id, element ? { ...element, id } : null] as const
      }),
    )
    fit()
    render()
  })

  connection.subscribe(() => {
    if (connection.status === "revoked") {
      connection.stop()
      hideBusy()
      show(GONE)
    } else if (connection.status === "busy") {
      void showBusy(connection)
    } else if (connection.status === "online") {
      hideBusy()
      show(null)
    }
  })
  connection.start()

  if (window.__SYNCANVAS_TEST__) {
    window.__syncanvasEmbed = {
      elements: () => listElements(doc),
      camera: () => camera,
      status: () => connection.status,
    }
  }
}

declare global {
  interface Window {
    __SYNCANVAS_TEST__?: boolean
    /** Test hook for the Embed viewer (M6 ticket 06). */
    __syncanvasEmbed?: {
      elements: () => ReturnType<typeof listElements>
      camera: () => Camera
      status: () => string
    }
  }
}

void start()
