import {
  addImage,
  ELEMENT_CAP,
  fittedSize,
  imageRow,
  type Point,
  type Size,
} from "@syncanvas/board-model"
import { IMAGE_MAX_BYTES, IMAGE_TOO_BIG, IMAGE_TYPES, IMAGE_WRONG_TYPE } from "@syncanvas/shared"
import { toast } from "sonner"
import type * as Y from "yjs"
import { create } from "zustand"
import { ApiError, api } from "@/lib/api"
import { imageCache } from "./image-cache"
import { useBoardUi } from "./store"

// Images on the canvas (M5b ticket 03; DESIGN.md → Images, FLOWS "Upload an image").
//
// - The image cache fetches each file once, with the session or (for Guests) the board token,
//   and decodes it to an ImageBitmap for the renderer. A file that isn't in this region's KV
//   yet answers 404: it retries with backoff for about a minute.
// - Uploads live in this tab until their key comes back; only then is the Element written,
//   so the doc never holds an image nobody can load.

export type { ImageAuth } from "./image-cache"
export { imageCache }

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
