import { canRename, normalizeBoardTitle, normalizeFolderName } from "@syncanvas/shared"
import { and, eq } from "drizzle-orm"
import type { Database } from "./db/client"
import { boards, folderBoards, folders, memberships } from "./db/schema"
import { type Caller, memberOrRefuse, refuse } from "./sharing"
import type { Broadcast } from "./threads"

// Board lifecycle from the dashboard and the Board menu (M5a): renaming, favorites, and, in
// later tickets, Folders, Trash, and deleting.

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
