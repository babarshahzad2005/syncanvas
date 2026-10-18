import {
  BOARDS_PER_USER,
  canRename,
  normalizeBoardTitle,
  normalizeFolderName,
  TRASH_DAYS,
} from "@syncanvas/shared"
import { and, eq, isNotNull, lt } from "drizzle-orm"
import { countOwned, findMembership } from "./boards"
import type { Database } from "./db/client"
import { boards, folderBoards, folders, memberships } from "./db/schema"
import { type Caller, memberOrRefuse, NO_ACCESS, refuse } from "./sharing"
import type { Broadcast } from "./threads"
import type { ThumbStore } from "./thumbnails"

// Board lifecycle from the dashboard and the Board menu (M5a): renaming, favorites, Folders,
// Trash, and deleting.

/** The Owner or an Editor renames a Board; everyone with it open sees the new title. */
export async function renameBoard(
  db: Database,
  broadcast: Broadcast,
  input: { boardId: string; caller: Caller; title: unknown },
) {
  const membership = await memberOrRefuse(db, input.boardId, input.caller)
  if (!canRename(membership.role)) {
    throw refuse(403, { error: "Only the owner and editors can rename this board." })
  }
  const title = normalizeBoardTitle(input.title)
  if (!title) throw refuse(400, { error: "Titles are 1–200 characters." })
  await db.update(boards).set({ title, updatedAt: new Date() }).where(eq(boards.id, input.boardId))
  try {
    await broadcast(input.boardId, { type: "board-renamed", title })
  } catch (error) {
    // Saved; open Boards show it on their next connection.
    console.error("Couldn't reach the board room:", error instanceof Error ? error.message : error)
  }
  return { title }
}

/** Stars or unstars a Board for the caller only. */
export async function setFavorite(
  db: Database,
  input: { boardId: string; caller: Caller; favorite: unknown },
) {
  await memberOrRefuse(db, input.boardId, input.caller)
  if (typeof input.favorite !== "boolean") {
    throw refuse(400, { error: "Say whether it's a favorite." })
  }
  await db
    .update(memberships)
    .set({ favorite: input.favorite })
    .where(and(eq(memberships.boardId, input.boardId), eq(memberships.userId, input.caller.id)))
  return { favorite: input.favorite }
}

// ---------- Folders (M5a ticket 02) ----------

function folderNameOrRefuse(input: unknown) {
  const name = normalizeFolderName(input)
  if (!name) throw refuse(400, { error: "Folder names are 1–60 characters." })
  return name
}

async function ownFolderOrRefuse(db: Database, folderId: string, caller: Caller) {
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, caller.id)))
    .limit(1)
  // Someone else's Folder looks the same as none at all.
  if (!folder) throw refuse(404, { error: "That folder doesn't exist." })
  return folder
}

export async function createFolder(db: Database, caller: Caller, name: unknown) {
  const [folder] = await db
    .insert(folders)
    .values({ id: crypto.randomUUID(), userId: caller.id, name: folderNameOrRefuse(name) })
    .returning({ id: folders.id, name: folders.name })
  if (!folder) throw new Error("Folder insert returned no row")
  return { ...folder, boardCount: 0 }
}

export async function renameFolder(db: Database, caller: Caller, folderId: string, name: unknown) {
  const next = folderNameOrRefuse(name)
  await ownFolderOrRefuse(db, folderId, caller)
  await db.update(folders).set({ name: next }).where(eq(folders.id, folderId))
  return { id: folderId, name: next }
}

/** Deletes a Folder; its Boards stay, back in "Your boards" only. */
export async function deleteFolder(db: Database, caller: Caller, folderId: string) {
  await ownFolderOrRefuse(db, folderId, caller)
  await db.delete(folders).where(eq(folders.id, folderId))
}

/** Puts a Board you can open into one of your Folders, or takes it out (null). */
export async function moveToFolder(
  db: Database,
  input: { boardId: string; caller: Caller; folderId: unknown },
) {
  await memberOrRefuse(db, input.boardId, input.caller)
  const mine = and(
    eq(folderBoards.boardId, input.boardId),
    eq(folderBoards.userId, input.caller.id),
  )
  if (input.folderId === null) {
    await db.delete(folderBoards).where(mine)
    return { folderId: null }
  }
  if (typeof input.folderId !== "string") throw refuse(400, { error: "Pick a folder." })
  await ownFolderOrRefuse(db, input.folderId, input.caller)
  await db
    .insert(folderBoards)
    .values({ folderId: input.folderId, boardId: input.boardId, userId: input.caller.id })
    .onConflictDoUpdate({
      target: [folderBoards.boardId, folderBoards.userId],
      set: { folderId: input.folderId },
    })
  return { folderId: input.folderId }
}

// ---------- Trash and the quota (M5a ticket 03) ----------

/** Closes every connection to a Board that went to Trash (board room `closeAll`). */
export type CloseAll = (boardId: string) => Promise<void>
/** Closes everything and deletes the board room's storage (board room `destroy`). */
export type DestroyRoom = (boardId: string) => Promise<void>

export const QUOTA_MESSAGE = `You own ${BOARDS_PER_USER} boards, the most for one account. Delete one or empty Trash to make room.`

/** Refuses a new (or restored) owned Board past the quota. Trash doesn't count. */
export async function checkQuota(db: Database, userId: string) {
  if ((await countOwned(db, userId)) >= BOARDS_PER_USER) {
    throw refuse(403, { error: QUOTA_MESSAGE, quota: true })
  }
}

/**
 * The caller's own Board, in Trash or not as asked. Members who aren't the Owner hear why;
 * everyone else (and anyone asking about a Board in someone else's Trash) gets the M3 answer.
 */
async function ownedOrRefuse(db: Database, boardId: string, caller: Caller, inTrash: boolean) {
  const [board] = await db
    .select({ ownerId: boards.ownerId, title: boards.title, deletedAt: boards.deletedAt })
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1)
  if (!board || board.ownerId !== caller.id) {
    if (!inTrash && (await findMembership(db, boardId, caller.id))) {
      throw refuse(403, { error: "Only the owner can delete this board." })
    }
    throw refuse(403, { error: NO_ACCESS })
  }
  if (inTrash && !board.deletedAt) throw refuse(409, { error: "That board isn't in Trash." })
  if (!inTrash && board.deletedAt) throw refuse(403, { error: NO_ACCESS })
  return board
}

async function tellRoom(call: () => Promise<void>) {
  try {
    await call()
  } catch (error) {
    console.error("Couldn't reach the board room:", error instanceof Error ? error.message : error)
  }
}

/** The Owner sends a Board to Trash: everyone's open connection to it closes at once. */
export async function deleteBoard(
  db: Database,
  closeAll: CloseAll,
  input: { boardId: string; caller: Caller },
) {
  await ownedOrRefuse(db, input.boardId, input.caller, false)
  await db.update(boards).set({ deletedAt: new Date() }).where(eq(boards.id, input.boardId))
  // Saved first: tokens for a Board in Trash are refused either way.
  await tellRoom(() => closeAll(input.boardId))
}

/** The Owner brings a Board back from Trash, with its Members, Threads, and content. */
export async function restoreBoard(db: Database, input: { boardId: string; caller: Caller }) {
  await ownedOrRefuse(db, input.boardId, input.caller, true)
  await checkQuota(db, input.caller.id)
  await db.update(boards).set({ deletedAt: null }).where(eq(boards.id, input.boardId))
}

/**
 * Deletes a Board for good: its room's storage first, then its thumbnail, then the row (the
 * rest cascades).
 */
async function purge(db: Database, destroy: DestroyRoom, thumbs: ThumbStore, boardId: string) {
  // If the room or KV can't be reached, keep the row so the next cleanup tries again.
  await destroy(boardId)
  const [board] = await db
    .select({ thumbnailKey: boards.thumbnailKey })
    .from(boards)
    .where(eq(boards.id, boardId))
    .limit(1)
  if (board?.thumbnailKey) await thumbs.delete(board.thumbnailKey)
  await db.delete(boards).where(eq(boards.id, boardId))
}

/** The Owner deletes a Board in Trash for good. */
export async function deleteForever(
  db: Database,
  destroy: DestroyRoom,
  thumbs: ThumbStore,
  input: { boardId: string; caller: Caller },
) {
  await ownedOrRefuse(db, input.boardId, input.caller, true)
  await purge(db, destroy, thumbs, input.boardId)
}

/** The daily cleanup's part (FLOWS §5): Boards in Trash for over 30 days go for good. */
export async function purgeTrash(
  db: Database,
  destroy: DestroyRoom,
  thumbs: ThumbStore,
  now: Date = new Date(),
) {
  const cutoff = new Date(now.getTime() - TRASH_DAYS * 24 * 60 * 60 * 1000)
  const old = await db
    .select({ id: boards.id })
    .from(boards)
    .where(and(isNotNull(boards.deletedAt), lt(boards.deletedAt, cutoff)))
  let purged = 0
  for (const { id } of old) {
    try {
      await purge(db, destroy, thumbs, id)
      purged++
    } catch (error) {
      console.error(`Couldn't purge board ${id}:`, error instanceof Error ? error.message : error)
    }
  }
  return { purged }
}
