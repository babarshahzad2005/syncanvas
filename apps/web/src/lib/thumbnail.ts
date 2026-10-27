import { type ElementWithId, indexById } from "@syncanvas/board-model"
import { boundsOf, type Camera, drawScene } from "@syncanvas/renderer"
import { THUMBNAIL_EVERY_MS, THUMBNAIL_MAX_BYTES } from "@syncanvas/shared"
import { imageCache } from "@/board/images"
import { ApiError, api } from "@/lib/api"

// Board thumbnails (M5a ticket 05; FLOWS §6): the whole Board drawn small in the light theme,
// uploaded when an Editor leaves a Board they changed. Templates' dashboard previews share the
// fitting.

/**
 * Fits `bounds` in the box with `padding` around it, however small that makes it (the
 * canvas's own fit stops at 10%), and never larger than `maxZoom`.
 */
export function fitAll(
  bounds: { x: number; y: number; w: number; h: number } | null,
  box: { w: number; h: number },
  padding = 8,
  maxZoom = Number.POSITIVE_INFINITY,
): Camera {
  if (!bounds) return { x: 0, y: 0, zoom: 1 }
  const zoom = Math.min(
    maxZoom,
    (box.w - padding * 2) / Math.max(bounds.w, 1),
    (box.h - padding * 2) / Math.max(bounds.h, 1),
  )
  return {
    zoom,
    x: box.w / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: box.h / 2 - (bounds.y + bounds.h / 2) * zoom,
  }
}

/** The tiles are 16:10; this is about twice their width on a large screen. */
const SIZE = { w: 640, h: 400 }

/** The Board as a WebP (PNG where the browser can't make WebP), or null if it can't draw. */
export function renderThumbnail(
  elements: readonly ElementWithId[],
  byId: ReadonlyMap<string, ElementWithId>,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas")
  canvas.width = SIZE.w
  canvas.height = SIZE.h
  const ctx = canvas.getContext("2d")
  if (!ctx) return Promise.resolve(null)
  drawScene(ctx, {
    elements,
    byId,
    // A single sticky note shouldn't fill the tile.
    camera: fitAll(boundsOf(elements, byId), SIZE, 32, 1),
    theme: "light",
    size: SIZE,
    dpr: 1,
    selection: new Set(),
    showGrid: false,
    images: imageCache.get,
  })
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.8))
}

/** How an upload went: stored, refused as too soon (another tab or device just sent one), or failed. */
export type UploadOutcome = "stored" | "too-soon" | "failed"

type Upload = (
  boardId: string,
  elements: readonly ElementWithId[],
  closing: boolean,
) => Promise<UploadOutcome>

/** A little past the server's window, so a waiting picture never arrives a moment too early. */
const SLACK_MS = 2_000

/**
 * Sends each Board's picture at most once per `THUMBNAIL_EVERY_MS` (the server's rule, for the
 * free plan's KV writes). One that comes too soon isn't dropped: it waits in this tab and goes
 * once allowed, so leaving a Board twice in a few minutes still ends with the latest picture.
 * A newer picture of the same Board replaces a waiting one. Closing the tab loses it, and the
 * next edit catches up.
 */
export function createThumbnailQueue(upload: Upload, clock: () => number = Date.now) {
  /** When this tab last sent (or was told "too soon") per Board. */
  const last = new Map<string, number>()
  const waiting = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; done: (stored: boolean) => void }
  >()

  const dueAt = (boardId: string) => (last.get(boardId) ?? -Infinity) + THUMBNAIL_EVERY_MS

  function send(
    boardId: string,
    elements: readonly ElementWithId[],
    closing: boolean,
  ): Promise<boolean> {
    const earlier = waiting.get(boardId)
    if (earlier) {
      clearTimeout(earlier.timer)
      waiting.delete(boardId)
      earlier.done(false) // replaced by this newer picture
    }
    const wait = dueAt(boardId) - clock()
    if (wait <= 0) return sendNow(boardId, elements, closing)
    return new Promise((done) => {
      const timer = setTimeout(() => {
        waiting.delete(boardId)
        void sendNow(boardId, elements, false).then(done)
      }, wait + SLACK_MS)
      waiting.set(boardId, { timer, done })
    })
  }

  async function sendNow(boardId: string, elements: readonly ElementWithId[], closing: boolean) {
    const outcome = await upload(boardId, elements, closing)
    if (outcome === "failed") return false
    last.set(boardId, clock())
    // Someone else's picture just went: this one waits its turn.
    return outcome === "stored" ? true : send(boardId, elements, false)
  }

  return { send }
}

async function uploadOnce(
  boardId: string,
  elements: readonly ElementWithId[],
  closing: boolean,
): Promise<UploadOutcome> {
  try {
    const blob = await renderThumbnail(elements, indexById(elements))
    if (!blob || blob.size > THUMBNAIL_MAX_BYTES) return "failed"
    // Browsers only let a request outlive the page if its body is under 64 KB.
    await api.uploadThumbnail(boardId, blob, closing && blob.size < 60_000)
    return "stored"
  } catch (error) {
    return error instanceof ApiError && error.status === 429 ? "too-soon" : "failed"
  }
}

const queue = createThumbnailQueue(uploadOnce)

/**
 * Renders and uploads this Board's picture now, or once it's allowed (see createThumbnailQueue);
 * resolves true once it's stored. Failures are silent (the dashboard keeps the old picture).
 * `closing`: the tab may be going away, so the request must outlive it.
 */
export function sendThumbnail(
  boardId: string,
  elements: readonly ElementWithId[],
  closing: boolean,
): Promise<boolean> {
  return queue.send(boardId, elements, closing)
}
