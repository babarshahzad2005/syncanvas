import {
  canEdit,
  IMAGE_MAX_BYTES,
  IMAGE_QUOTA_BYTES,
  type ImageType,
  type ImageUploadResponse,
} from "@syncanvas/shared"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { VerifiedBoardToken } from "./board-token"
import { findMembership } from "./boards"
import type { Database } from "./db/client"
import { boards, images } from "./db/schema"
import { type Caller, memberOrRefuse, NO_ACCESS, refuse } from "./sharing"
import { type AssetStore, forget, KV_WRITES_FOR_IMAGES, takeKvWrite } from "./thumbnails"

// Images on Boards (M5b ticket 02; FLOWS "Upload an image", ADR 0007): Editors upload them
// through the Worker into KV, and anyone who can open the Board reads them from our origin.
// Each upload is a new key whose bytes never change, so reads are cached for good.

export const IMAGE_TOO_BIG = "Images can be up to 5 MB."
export const IMAGE_WRONG_TYPE = "Images can be PNG, JPEG, GIF, or WebP."
export const IMAGE_QUOTA =
  "You've used your 50 MB for images. Delete boards you don't need to free space."
export const IMAGE_PAUSED = "Image uploads are paused until tomorrow."

export type ImageInfo = { type: ImageType; width: number; height: number }

const be16 = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0)
const le16 = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8)
const le24 = (b: Uint8Array, i: number) => le16(b, i) | ((b[i + 2] ?? 0) << 16)
const be32 = (b: Uint8Array, i: number) => ((be16(b, i) << 16) | be16(b, i + 2)) >>> 0
const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to))

/**
 * What kind of image the bytes are, and its size as shown, read from the header alone (the
 * Content-Type header isn't trusted). Null for anything that isn't PNG, JPEG, GIF, or WebP.
 */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  const info = readHeader(b)
  return info && info.width > 0 && info.height > 0 ? info : null
}

function readHeader(b: Uint8Array): ImageInfo | null {
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) {
    if (ascii(b, 12, 16) !== "IHDR") return null
    return { type: "image/png", width: be32(b, 16), height: be32(b, 20) }
  }
  const gif = ascii(b, 0, 6)
  if (gif === "GIF87a" || gif === "GIF89a") {
    return { type: "image/gif", width: le16(b, 6), height: le16(b, 8) }
  }
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return webpSize(b)
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpegSize(b)
  return null
}

function webpSize(b: Uint8Array): ImageInfo | null {
  const chunk = ascii(b, 12, 16)
  const type = "image/webp"
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return { type, width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff }
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null
    const [b1 = 0, b2 = 0, b3 = 0, b4 = 0] = b.subarray(21, 25)
    return {
      type,
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    }
  }
  if (chunk === "VP8X") return { type, width: 1 + le24(b, 24), height: 1 + le24(b, 27) }
  return null
}

/** Walks the JPEG markers to the frame header, noting the EXIF orientation on the way. */
function jpegSize(b: Uint8Array): ImageInfo | null {
  let i = 2
  let turned = false
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1] ?? 0
    if (marker === 0xff) {
      i++
      continue
    }
    const length = be16(b, i + 2)
    if (marker === 0xe1 && ascii(b, i + 4, i + 10) === "Exif\0\0") {
      turned = exifTurnsSideways(b.subarray(i + 10, i + 2 + length))
    }
    // Start-of-frame markers, except DHT (C4), JPG (C8), and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = be16(b, i + 5)
      const width = be16(b, i + 7)
      // Browsers apply the orientation, so a portrait phone photo is shown portrait.
      return turned
        ? { type: "image/jpeg", width: height, height: width }
        : { type: "image/jpeg", width, height }
    }
    i += 2 + length
  }
  return null
}

/** Whether an EXIF block (a TIFF) says to rotate by 90° (orientations 5–8). */
function exifTurnsSideways(t: Uint8Array) {
  const little = ascii(t, 0, 2) === "II"
  const u16 = (i: number) => (little ? le16(t, i) : be16(t, i))
  const u32 = (i: number) => (little ? (u16(i) | (u16(i + 2) << 16)) >>> 0 : be32(t, i))
  const dir = u32(4)
  const count = u16(dir)
  for (let n = 0; n < count; n++) {
    const entry = dir + 2 + n * 12
    if (entry + 12 > t.length) return false
    if (u16(entry) === 0x0112) return u16(entry + 8) >= 5 && u16(entry + 8) <= 8
  }
  return false
}

/** Image bytes a User has uploaded to Boards that still exist (deleted Boards cascade). */
async function bytesUsed(db: Database, userId: string) {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${images.bytes}), 0)`.mapWith(Number) })
    .from(images)
    .where(eq(images.userId, userId))
  return row?.total ?? 0
}

/** An Editor (or the Owner) adds an image file to a Board. */
export async function uploadImage(
  db: Database,
  store: AssetStore,
  input: { boardId: string; caller: Caller; bytes: ArrayBuffer; now?: Date },
): Promise<ImageUploadResponse> {
  const membership = await memberOrRefuse(db, input.boardId, input.caller)
  if (!canEdit(membership.role)) {
    throw refuse(403, { error: "Only the owner and editors can add images." })
  }
  if (input.bytes.byteLength > IMAGE_MAX_BYTES) throw refuse(413, { error: IMAGE_TOO_BIG })
  const info = imageInfo(new Uint8Array(input.bytes))
  if (!info) throw refuse(415, { error: IMAGE_WRONG_TYPE })
  // Two uploads at once can pass this together; going a few MB over is harmless.
  if ((await bytesUsed(db, input.caller.id)) + input.bytes.byteLength > IMAGE_QUOTA_BYTES) {
    throw refuse(403, { error: IMAGE_QUOTA, quota: true })
  }
  if (!(await takeKvWrite(db, input.now ?? new Date(), KV_WRITES_FOR_IMAGES))) {
    throw refuse(503, { error: IMAGE_PAUSED })
  }

  const key = `images/${input.boardId}/${crypto.randomUUID()}`
  await store.put(key, input.bytes, info.type)
  try {
    await db.insert(images).values({
      key,
      boardId: input.boardId,
      userId: input.caller.id,
      bytes: input.bytes.byteLength,
      contentType: info.type,
    })
  } catch (error) {
    await forget(store, key)
    throw error
  }
  return { key, width: info.width, height: info.height }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * An image file, for a Member (their session) or anyone holding a board token for its Board
 * (Guests, and later Embeds). 404 while KV hasn't reached this region yet: the canvas shows
 * its placeholder and tries again.
 */
export async function readImage(
  db: Database,
  store: AssetStore,
  input: {
    boardId: string
    id: string
    reader:
      | { kind: "member"; userId: string }
      | { kind: "token"; claims: VerifiedBoardToken | null }
  },
) {
  const { boardId, reader } = input
  if (reader.kind === "member") {
    if (!(await findMembership(db, boardId, reader.userId))) throw refuse(403, { error: NO_ACCESS })
  } else {
    if (!reader.claims || reader.claims.boardId !== boardId) throw refuse(403, { error: NO_ACCESS })
    // Tokens live 5 minutes; a Board sent to Trash meanwhile is closed to them at once.
    const [board] = await db
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)))
      .limit(1)
    if (!board) throw refuse(403, { error: NO_ACCESS })
  }
  const found = UUID.test(input.id) ? await store.get(`images/${boardId}/${input.id}`) : null
  if (!found) throw refuse(404, { error: "That image isn't available yet." })
  return found
}

/** Deletes a Board's image files (its rows go with the Board). */
export async function deleteBoardImages(db: Database, store: AssetStore, boardId: string) {
  const rows = await db.select({ key: images.key }).from(images).where(eq(images.boardId, boardId))
  // Throws if KV can't be reached, so purge keeps the Board for the next cleanup.
  for (const { key } of rows) await store.delete(key)
}
