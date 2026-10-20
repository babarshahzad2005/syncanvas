import {
  CLIPBOARD_TYPE,
  type ClipboardPayload,
  copyPayload,
  deleteElements,
  ELEMENT_CAP,
  type ElementWithId,
  indexById,
  type Point,
  parsePayload,
  pasteElements,
} from "@syncanvas/board-model"
import { boundsOf, connectorEndAsDrawn, drawImage, imageSize } from "@syncanvas/renderer"
import { toast } from "sonner"
import type * as Y from "yjs"
import { imageCache } from "./images"
import { useBoardUi } from "./store"

// Copy, cut, paste, and duplicate (spec: Copy and paste; ADR 0011).
//
// Copying writes three formats at once:
// - `text/html`: an <img> of the selection whose `data-syncanvas` attribute carries the
//   Elements. Paste reads it from the ordinary paste event: no permission prompt, any browser.
//   Pasted into a doc or a chat, it's just the picture.
// - `image/png`: the same picture, for apps that only take images.
// - `web application/x-syncanvas+json`: the Elements, where the browser supports custom
//   formats (Chromium), for anything that reads them.

type Context = {
  doc: Y.Doc
  origin: object
  undoManager: Y.UndoManager
  /** Every Element by id, and in drawing order (from the canvas's index). */
  byId: ReadonlyMap<string, ElementWithId>
  all: readonly ElementWithId[]
}

/** Duplicates land this far (canvas units) right and down from the original. */
const DUPLICATE_OFFSET = 16
const MARKER = "data-syncanvas"

/** If copying to the system clipboard fails, paste in this tab still works from here. */
let fallback: ClipboardPayload | null = null

/** The selected Elements in drawing order, with what copying needs to know about them. */
function selected(ctx: Context): ElementWithId[] {
  const { selection } = useBoardUi.getState()
  return ctx.all.filter((e) => selection.has(e.id))
}

function payloadOf(ctx: Context, elements: readonly ElementWithId[]): ClipboardPayload {
  return copyPayload(elements, (end) => connectorEndAsDrawn(end, ctx.byId))
}

const encode = (text: string) => btoa(String.fromCodePoint(...new TextEncoder().encode(text)))
const decode = (base64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.codePointAt(0) ?? 0))

/** A PNG of the Elements, drawn like the canvas in the light theme. */
export async function pictureOf(
  elements: readonly ElementWithId[],
  byId: ReadonlyMap<string, ElementWithId>,
): Promise<Blob> {
  const bounds = boundsOf(elements, byId) ?? { x: 0, y: 0, w: 1, h: 1 }
  const size = imageSize(bounds)
  const canvas = document.createElement("canvas")
  canvas.width = size.w
  canvas.height = size.h
  const ctx = canvas.getContext("2d")
  if (ctx) drawImage(ctx, elements, byId, bounds, size, undefined, imageCache.get)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no picture"))), "image/png"),
  )
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

/** Copies the selection (Viewers too). Returns false when nothing is selected. */
export function copySelection(ctx: Context): boolean {
  const elements = selected(ctx)
  if (elements.length === 0) return false
  const payload = payloadOf(ctx, elements)
  fallback = payload
  const json = JSON.stringify(payload)
  // The picture is drawn asynchronously; the clipboard takes promises, so the write still
  // happens within the key press that asked for it.
  const png = pictureOf(elements, ctx.byId)
  const html = png.then(async (blob) => {
    const marker = `${MARKER}="${encode(json)}"`
    return new Blob([`<img src="${await dataUrl(blob)}" alt="Syncanvas" ${marker}>`], {
      type: "text/html",
    })
  })
  const items: Record<string, Promise<Blob> | Blob> = { "text/html": html, "image/png": png }
  if (typeof ClipboardItem !== "undefined" && ClipboardItem.supports?.(CLIPBOARD_TYPE)) {
    items[CLIPBOARD_TYPE] = new Blob([json], { type: CLIPBOARD_TYPE })
  }
  void navigator.clipboard
    ?.write([new ClipboardItem(items)])
    .then(() => {
      fallback = null // the system clipboard has it now, and may later hold something else
    })
    .catch(() => {
      // No clipboard access (permissions, an old browser): pasting in this tab still works.
    })
  return true
}

/** Copies, then deletes the (unlocked) selection as one undo step. */
export function cutSelection(ctx: Context) {
  if (!copySelection(ctx)) return
  ctx.undoManager.stopCapturing()
  deleteElements(
    ctx.doc,
    selected(ctx)
      .filter((e) => !e.locked)
      .map((e) => e.id),
    ctx.origin,
  )
  useBoardUi.getState().select([])
}

/** The Elements in a paste event's clipboard, or null when it holds none of ours. */
export function elementsFromPaste(event: ClipboardEvent): ElementWithId[] | null {
  const html = event.clipboardData?.getData("text/html") ?? ""
  if (html.includes(MARKER)) {
    const img = new DOMParser().parseFromString(html, "text/html").querySelector(`[${MARKER}]`)
    try {
      const elements = parsePayload(JSON.parse(decode(img?.getAttribute(MARKER) ?? "")))
      if (elements.length > 0) return elements
    } catch {
      // Not ours after all.
    }
  }
  // Copying here couldn't reach the system clipboard; use what this tab kept, unless the
  // clipboard now holds something else.
  const types = event.clipboardData?.types ?? []
  if (fallback && types.length === 0) return parsePayload(fallback)
  return null
}

/**
 * Pastes Elements centered on `at` (the cursor, or the viewport's center) and selects them.
 * Needs Editor access, and room under the Element cap.
 */
export function pasteAt(ctx: Context, elements: readonly ElementWithId[], at: Point) {
  if (ctx.all.length + elements.length > ELEMENT_CAP) {
    toast.error("This Board is full", {
      description: `${ELEMENT_CAP.toLocaleString("en-US")} Elements is the limit. Delete some to make room, or paste into another Board.`,
    })
    return
  }
  const bounds = boundsOf(elements, indexById(elements))
  if (!bounds) return
  const offset = { x: at.x - (bounds.x + bounds.w / 2), y: at.y - (bounds.y + bounds.h / 2) }
  ctx.undoManager.stopCapturing()
  const ids = pasteElements(ctx.doc, elements, offset, ctx.origin)
  useBoardUi.getState().select(ids)
}

/** Duplicates the selection 16 units right and down, and selects the copy (Ctrl/Cmd+D). */
export function duplicateSelection(ctx: Context) {
  const elements = selected(ctx)
  if (elements.length === 0) return
  if (ctx.all.length + elements.length > ELEMENT_CAP) {
    pasteAt(ctx, elements, { x: 0, y: 0 }) // shows the message
    return
  }
  ctx.undoManager.stopCapturing()
  const payload = payloadOf(ctx, elements)
  const ids = pasteElements(
    ctx.doc,
    payload.elements,
    { x: DUPLICATE_OFFSET, y: DUPLICATE_OFFSET },
    ctx.origin,
  )
  useBoardUi.getState().select(ids)
}
