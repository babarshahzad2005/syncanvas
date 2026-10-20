import {
  addImage,
  ELEMENT_CAP,
  fittedSize,
  type ImageElement,
  imageRow,
  type Point,
  type Size,
} from "@syncanvas/board-model"
import type { ImageSource, ImageState } from "@syncanvas/renderer"
import {
  IMAGE_MAX_BYTES,
  IMAGE_TOO_BIG,
  IMAGE_TYPES,
  IMAGE_WRONG_TYPE,
  imageUrl,
} from "@syncanvas/shared"
import { toast } from "sonner"
import type * as Y from "yjs"
import { create } from "zustand"
import { ApiError, api } from "@/lib/api"
import { useBoardUi } from "./store"

// Images on the canvas (M5b ticket 03; DESIGN.md → Images, FLOWS "Upload an image").
//
// - The image cache fetches each file once, with the session or (for Guests) the board token,
//   and decodes it to an ImageBitmap for the renderer. A file that isn't in this region's KV
//   yet answers 404: it retries with backoff for about a minute.
// - Uploads live in this tab until their key comes back; only then is the Element written,
//   so the doc never holds an image nobody can load.

// ---------- The image cache ----------

/** Pictures are decoded no bigger than this on their longer side (a 5 MB file can be huge). */
const MAX_DECODE_SIDE = 4096
/** Waits between tries for a file that hasn't reached this region yet (about 60 s in all). */
const RETRY_MS = [1000, 2000, 4000, 8000, 15_000, 15_000, 15_000]

/**
 * Headers that let this tab read the Board's images: none for a Member (the session cookie
 * goes along), a board token for a Guest. `fresh`: the last one was refused, get a new one.
 */
export type ImageAuth = (fresh: boolean) => Promise<Record<string, string>>

type Entry = { state: ImageState; tries: number }

async function decode(blob: Blob, natural?: Size): Promise<ImageBitmap> {
  const side = natural ? Math.max(natural.w, natural.h) : 0
  if (natural && side > MAX_DECODE_SIDE) {
    const k = MAX_DECODE_SIDE / side
    return createImageBitmap(blob, {
      resizeWidth: Math.max(1, Math.round(natural.w * k)),
      resizeHeight: Math.max(1, Math.round(natural.h * k)),
      resizeQuality: "high",
    })
  }
  return createImageBitmap(blob)
}

class ImageCache {
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private auth: ImageAuth = async () => ({})

  /** Sets how this tab reads images (once per Board). */
  setAuth(auth: ImageAuth) {
    this.auth = auth
  }

  /** Called whenever a file finishes loading (or is given up on). */
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** For the renderer: the file behind an image Element, loading it the first time. */
  readonly get: ImageSource = (e: ImageElement) => {
    let entry = this.entries.get(e.key)
    if (!entry) {
      entry = { state: "loading", tries: 0 }
      this.entries.set(e.key, entry)
      void this.load(e.key, entry, e.natural)
    }
    return entry.state
  }

  /** Test hook: how far a file has got (null before anything asked for it). */
  stateOf(key: string): "ready" | "loading" | "missing" | null {
    const state = this.entries.get(key)?.state
    return state === undefined ? null : typeof state === "object" ? "ready" : state
  }

  /** A file this tab just uploaded: no need to download it again. */
  seed(key: string, bitmap: ImageBitmap) {
    this.entries.set(key, { state: { bitmap }, tries: 0 })
    this.notify()
  }

  /** A file's bytes, for copying it to another Board. */
  async blob(key: string): Promise<Blob> {
    const res = await this.fetch(key)
    if (!res.ok) throw new ApiError(res.status, "Couldn't read the image.")
    return res.blob()
  }

  private async fetch(key: string) {
    const res = await fetch(imageUrl(key), {
      credentials: "same-origin",
      headers: await this.auth(false),
    })
    // A Guest's board token lasts 5 minutes; get a new one and try once more.
    if (res.status !== 403) return res
    const headers = await this.auth(true)
    if (Object.keys(headers).length === 0) return res
    return fetch(imageUrl(key), { credentials: "same-origin", headers })
  }

  private async load(key: string, entry: Entry, natural: Size) {
    try {
      const res = await this.fetch(key)
      if (res.ok) {
        entry.state = { bitmap: await decode(await res.blob(), natural) }
        return this.notify()
      }
      // 404: not in this region's KV yet. Anything else won't get better by waiting.
      if (res.status !== 404) return this.giveUp(entry)
    } catch {
      // Offline, or a file that won't decode: try again like a missing one.
    }
    const wait = RETRY_MS[entry.tries++]
    if (wait === undefined) return this.giveUp(entry)
    setTimeout(() => void this.load(key, entry, natural), wait)
  }

  private giveUp(entry: Entry) {
    entry.state = "missing"
    this.notify()
  }

  private notify() {
    for (const l of this.listeners) l()
  }
}

/** One cache for the app: image keys are unique across Boards. */
export const imageCache = new ImageCache()

// ---------- Uploads ----------

export type Upload = {
  id: string
  file: Blob
  bitmap: ImageBitmap
  natural: Size
  position: Point
  size: Size
  failed: boolean
}

type Uploads = {
  uploads: Upload[]
  /** Opens the file picker (registered by the canvas; the dock's Image button and I call it). */
  pick: (() => void) | null
}

export const useUploads = create<Uploads>(() => ({ uploads: [], pick: null }))

function setUpload(id: string, change: Partial<Upload> | null) {
  useUploads.setState((s) => ({
    uploads: change
      ? s.uploads.map((u) => (u.id === id ? { ...u, ...change } : u))
      : s.uploads.filter((u) => u.id !== id),
  }))
}

/** Clipboard and drop contents that are image files (of any type: the checks come later). */
export function imageFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter((f) => f.type.startsWith("image/"))
}

export type ImageTarget = {
  boardId: string
  doc: Y.Doc
  origin: object
  /** How many Elements the Board has now (the Element cap counts images). */
  count: number
}

/**
 * Adds image files around `at`: each is checked (type and size, with the API's words), shown
 * as a placeholder in a row, uploaded, and written as an Element when its key comes back.
 */
export async function addImages(target: ImageTarget, files: readonly File[], at: Point) {
  const accepted: File[] = []
  for (const file of files) {
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) toast.error(IMAGE_WRONG_TYPE)
    else if (file.size > IMAGE_MAX_BYTES) toast.error(IMAGE_TOO_BIG)
    else accepted.push(file)
  }
  if (accepted.length === 0) return
  if (target.count + accepted.length > ELEMENT_CAP) {
    toast.error("This Board is full", {
      description: `${ELEMENT_CAP.toLocaleString("en-US")} Elements is the limit. Delete some to make room.`,
    })
    return
  }
  // Decoding gives the size as shown (photos turned by their EXIF data) before uploading.
  const decoded = await Promise.all(
    accepted.map(async (file) => {
      try {
        return { file, bitmap: await createImageBitmap(file) }
      } catch {
        toast.error(IMAGE_WRONG_TYPE)
        return null
      }
    }),
  )
  const ready = decoded.filter((d) => d !== null)
  const sizes = ready.map(({ bitmap }) => fittedSize({ w: bitmap.width, h: bitmap.height }))
  const positions = imageRow(sizes, at)
  const uploads = ready.map(({ file, bitmap }, i) => ({
    id: crypto.randomUUID(),
    file,
    bitmap,
    natural: { w: bitmap.width, h: bitmap.height },
    position: positions[i] ?? at,
    size: sizes[i] ?? { w: bitmap.width, h: bitmap.height },
    failed: false,
  }))
  useUploads.setState((s) => ({ uploads: [...s.uploads, ...uploads] }))
  await Promise.all(uploads.map((u) => send(target, u)))
}

/** Uploads one placeholder's file and writes its Element, or marks it failed. */
async function send(target: ImageTarget, upload: Upload) {
  try {
    const { key } = await api.uploadImage(target.boardId, upload.file)
    imageCache.seed(key, upload.bitmap)
    const id = addImage(
      target.doc,
      { key, natural: upload.natural, position: upload.position, size: upload.size },
      target.origin,
    )
    setUpload(upload.id, null)
    useBoardUi.getState().select([id])
  } catch (error) {
    setUpload(upload.id, { failed: true })
    toast.error(
      error instanceof ApiError && error.status !== 500
        ? error.message
        : "Couldn't upload the image",
    )
  }
}

/** Retry on a failed placeholder. */
export function retryUpload(target: ImageTarget, id: string) {
  const upload = useUploads.getState().uploads.find((u) => u.id === id)
  if (!upload) return
  setUpload(id, { failed: false })
  void send(target, { ...upload, failed: false })
}

/** The × on a failed placeholder. */
export function dismissUpload(id: string) {
  setUpload(id, null)
}

/** A new Board starts with none of the last one's placeholders. */
export function clearUploads() {
  useUploads.setState({ uploads: [] })
}

/**
 * Copies images from other Boards into this one (pasting Elements copied elsewhere): each
 * file is read with the access this tab has there and uploaded here. Returns the new keys by
 * old key; files that couldn't be copied are left out.
 */
export async function copyImagesHere(boardId: string, keys: readonly string[]) {
  const copies = new Map<string, string>()
  let failed = 0
  await Promise.all(
    keys.map(async (key) => {
      try {
        const blob = await imageCache.blob(key)
        const { key: copy } = await api.uploadImage(boardId, blob)
        copies.set(key, copy)
      } catch (error) {
        failed++
        if (error instanceof ApiError && error.status === 503) toast.error(error.message)
      }
    }),
  )
  if (failed > 0) {
    toast.error(failed === 1 ? "Couldn't copy an image" : `Couldn't copy ${failed} images`, {
      description: "The rest was pasted.",
    })
  }
  return copies
}
