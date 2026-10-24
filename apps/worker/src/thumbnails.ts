import {
  canEdit,
  THUMBNAIL_EVERY_MS,
  THUMBNAIL_MAX_BYTES,
  type ThumbnailResponse,
} from "@syncanvas/shared"
import { and, eq, isNull, lt, sql } from "drizzle-orm"
import type { VerifiedBoardToken } from "./board-token"
import { findMembership } from "./boards"
import type { Database } from "./db/client"
import { boards, kvWrites } from "./db/schema"
import { type Caller, memberOrRefuse, NO_ACCESS, refuse } from "./sharing"

// Board thumbnails (M5a ticket 05; FLOWS §6, ADR 0007): an Editor's browser renders the Board
// when they leave it changed and uploads it here; the dashboard shows it. Each upload is a new
// KV key, so an edge or browser copy is never stale: KV can take ~60 s to show a value
// elsewhere, and a reused key could serve the old picture under the new URL.

/** Where thumbnails and images live (Workers KV in production, a Map in tests). */
export type AssetStore = {
  put(key: string, bytes: ArrayBuffer, contentType: string): Promise<void>
  get(key: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null>
  delete(key: string): Promise<void>
}

export function kvAssetStore(kv: KVNamespace): AssetStore {
  return {
    put: (key, bytes, contentType) => kv.put(key, bytes, { metadata: { contentType } }),
    get: async (key) => {
      const { value, metadata } = await kv.getWithMetadata<{ contentType?: string }>(
        key,
        "arrayBuffer",
      )
      return value ? { bytes: value, contentType: metadata?.contentType ?? "image/webp" } : null
    },
    delete: (key) => kv.delete(key),
  }
}

/**
 * One daily count of KV writes, under KV's 1,000 free a day. Thumbnails stop first, so a busy
 * day of them never blocks images (M5b ticket 02).
 */
export const KV_WRITES_FOR_THUMBNAILS = 700
export const KV_WRITES_FOR_IMAGES = 950

/** The version is the upload time in base 36, which also drives the 10-minute limit. */
function keyFor(boardId: string, at: Date) {
  return `thumbs/${boardId}/${at.getTime().toString(36)}`
}
function versionOf(key: string) {
  return key.split("/")[2] ?? ""
}
function uploadedAt(key: string) {
  return Number.parseInt(versionOf(key), 36)
}

/** The dashboard's URL for a Board's thumbnail, or null before the first upload. */
export function thumbnailUrl(boardId: string, key: string | null) {
  return key ? `/api/assets/thumbs/${boardId}?v=${versionOf(key)}` : null
}

const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x),
  // "RIFF" …size… "WEBP"
  "image/webp": (b) =>
    String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.subarray(8, 12)) === "WEBP",
}

/**
 * Counts one KV write for today, unless today's count has reached `cap`. Returns whether the
 * write may go ahead.
 */
export async function takeKvWrite(db: Database, now: Date, cap: number) {
  const day = now.toISOString().slice(0, 10)
  const rows = await db
    .insert(kvWrites)
    .values({ day, count: 1 })
    .onConflictDoUpdate({
      target: kvWrites.day,
      set: { count: sql`${kvWrites.count} + 1` },
      setWhere: lt(kvWrites.count, cap),
    })
    .returning({ count: kvWrites.count })
  return rows.length > 0
}

/** An Editor (or the Owner) replaces a Board's thumbnail. */
export async function uploadThumbnail(
  db: Database,
  store: AssetStore,
  input: {
    boardId: string
    caller: Caller
    contentType: string
    bytes: ArrayBuffer
    now?: Date
  },
): Promise<ThumbnailResponse> {
  const now = input.now ?? new Date()
  const membership = await memberOrRefuse(db, input.boardId, input.caller)
  if (!canEdit(membership.role)) {
    throw refuse(403, { error: "Only the owner and editors can update the thumbnail." })
  }
  const type = input.contentType.split(";")[0]?.trim().toLowerCase() ?? ""
  const looksRight = SIGNATURES[type]
  if (!looksRight?.(new Uint8Array(input.bytes))) {
    throw refuse(415, { error: "Thumbnails are WebP or PNG images." })
  }
  if (input.bytes.byteLength > THUMBNAIL_MAX_BYTES) {
    throw refuse(413, { error: "Thumbnails are at most 200 KB." })
  }
  const [board] = await db
    .select({ thumbnailKey: boards.thumbnailKey })
    .from(boards)
    .where(eq(boards.id, input.boardId))
    .limit(1)
  const old = board?.thumbnailKey ?? null
  const tooSoon = () =>
    refuse(429, { error: "This board's thumbnail was updated in the last 10 minutes." })
  if (old && now.getTime() - uploadedAt(old) < THUMBNAIL_EVERY_MS) throw tooSoon()
  if (!(await takeKvWrite(db, now, KV_WRITES_FOR_THUMBNAILS))) {
    throw refuse(503, { error: "Thumbnails are paused until tomorrow." })
  }

  const key = keyFor(input.boardId, now)
  await store.put(key, input.bytes, type)
  // Only if nobody else uploaded meanwhile.
  const won = await db
    .update(boards)
    .set({ thumbnailKey: key })
    .where(
      and(
        eq(boards.id, input.boardId),
        old ? eq(boards.thumbnailKey, old) : isNull(boards.thumbnailKey),
      ),
    )
    .returning({ id: boards.id })
  if (won.length === 0) {
    await forget(store, key)
    throw tooSoon()
  }
  if (old) await forget(store, old)
  return { thumbnailUrl: thumbnailUrl(input.boardId, key) ?? "" }
}

/** Deletes a KV key; a leftover file is only wasted space, so failures are logged. */
export async function forget(store: AssetStore, key: string) {
  try {
    await store.delete(key)
  } catch (error) {
    console.error(`Couldn't delete ${key}:`, error instanceof Error ? error.message : error)
  }
}

/**
 * Who's reading a Board's file: a Member by their session, or anyone holding a board token
 * (Guests and Embed viewers; M6 ticket 07 uses it for the busy picture).
 */
export type AssetReader =
  | { kind: "member"; userId: string }
  | { kind: "token"; claims: VerifiedBoardToken | null }

/** Refuses a reader who can't open the Board (a token for another Board, or for one in Trash). */
export async function readerOrRefuse(db: Database, boardId: string, reader: AssetReader) {
  if (reader.kind === "member") {
    if (!(await findMembership(db, boardId, reader.userId))) throw refuse(403, { error: NO_ACCESS })
    return
  }
  if (!reader.claims || reader.claims.boardId !== boardId) throw refuse(403, { error: NO_ACCESS })
  // Tokens live 5 minutes; a Board sent to Trash meanwhile is closed to them at once.
  const [board] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)))
    .limit(1)
  if (!board) throw refuse(403, { error: NO_ACCESS })
}

/**
 * A Board's current thumbnail, for anyone who can open it. `fresh` says whether the asked-for
 * version is the current one (only then may the browser keep it for good).
 */
export async function readThumbnail(
  db: Database,
  store: AssetStore,
  input: { boardId: string; reader: AssetReader; version: string | undefined },
) {
  await readerOrRefuse(db, input.boardId, input.reader)
  const [board] = await db
    .select({ thumbnailKey: boards.thumbnailKey })
    .from(boards)
    .where(eq(boards.id, input.boardId))
    .limit(1)
  const key = board?.thumbnailKey
  const found = key ? await store.get(key) : null
  // A new key may not have reached this region yet; the tile shows its placeholder.
  if (!key || !found) throw refuse(404, { error: "No thumbnail yet." })
  return { ...found, fresh: input.version === versionOf(key) }
}
