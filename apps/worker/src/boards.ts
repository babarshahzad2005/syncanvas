import type { BoardSummary, FolderSummary, TrashedBoard } from "@syncanvas/shared"
import { and, asc, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import type { Database } from "./db/client"
import { boards, folderBoards, folders, memberships, user } from "./db/schema"

/** Creates a Board and its Owner Membership together: either both rows exist or neither does. */
export async function createBoard(db: Database, input: { ownerId: string; title?: string }) {
  const id = crypto.randomUUID()
  return db.transaction(async (tx) => {
    const [board] = await tx
      .insert(boards)
      .values({ id, ownerId: input.ownerId, ...(input.title ? { title: input.title } : {}) })
      .returning({ id: boards.id, title: boards.title })
    await tx
      .insert(memberships)
      .values({ boardId: id, userId: input.ownerId, role: "owner", via: "owner" })
    if (!board) throw new Error("Board insert returned no row")
    return board
  })
}

/**
 * Every Board the User is a Member of (owned or shared), most recently opened first. Boards
 * they've never opened (newly shared ones) come after, newest edit first (M5 planning).
 */
export async function listBoards(db: Database, userId: string): Promise<BoardSummary[]> {
  const rows = await db
    .select({
      id: boards.id,
      title: boards.title,
      role: memberships.role,
      updatedAt: boards.updatedAt,
      thumbnailKey: boards.thumbnailKey,
      lastOpenedAt: memberships.lastOpenedAt,
      favorite: memberships.favorite,
      folderId: folderBoards.folderId,
      ownerId: user.id,
      ownerName: user.name,
      ownerEmail: user.email,
    })
    .from(memberships)
    .innerJoin(boards, eq(boards.id, memberships.boardId))
    .innerJoin(user, eq(user.id, boards.ownerId))
    .leftJoin(
      folderBoards,
      and(eq(folderBoards.boardId, boards.id), eq(folderBoards.userId, userId)),
    )
    .where(and(eq(memberships.userId, userId), isNull(boards.deletedAt)))
    .orderBy(sql`${memberships.lastOpenedAt} desc nulls last`, desc(boards.updatedAt))

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    role: r.role,
    owner: { id: r.ownerId, name: r.ownerName, email: r.ownerEmail },
    updatedAt: r.updatedAt.toISOString(),
    thumbnailKey: r.thumbnailKey,
    lastOpenedAt: r.lastOpenedAt?.toISOString() ?? null,
    favorite: r.favorite,
    folderId: r.folderId,
  }))
}

/** The User's own Boards in Trash, most recently deleted first. */
export async function listTrash(db: Database, userId: string): Promise<TrashedBoard[]> {
  const rows = await db
    .select({ id: boards.id, title: boards.title, deletedAt: boards.deletedAt })
    .from(boards)
    .where(and(eq(boards.ownerId, userId), isNotNull(boards.deletedAt)))
    .orderBy(desc(boards.deletedAt))
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    deletedAt: r.deletedAt?.toISOString() ?? "",
  }))
}

/** How many Boards the User owns outside Trash (the quota counts these). */
export async function countOwned(db: Database, userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(boards)
    .where(and(eq(boards.ownerId, userId), isNull(boards.deletedAt)))
  return row?.n ?? 0
}

/** The User's Folders, by name, each with how many of their open Boards it holds. */
export async function listFolders(db: Database, userId: string): Promise<FolderSummary[]> {
  const rows = await db
    .select({ id: folders.id, name: folders.name, boardCount: count(boards.id) })
    .from(folders)
    .leftJoin(folderBoards, eq(folderBoards.folderId, folders.id))
    .leftJoin(boards, and(eq(boards.id, folderBoards.boardId), isNull(boards.deletedAt)))
    .where(eq(folders.userId, userId))
    .groupBy(folders.id, folders.name)
    .orderBy(asc(folders.name))
  return rows
}

/** Notes that the User opened the Board just now (for the dashboard's order). */
export async function markOpened(db: Database, boardId: string, userId: string) {
  await db
    .update(memberships)
    .set({ lastOpenedAt: new Date() })
    .where(and(eq(memberships.boardId, boardId), eq(memberships.userId, userId)))
}

/** The User's Role on a Board and its title, or null if they aren't a Member (or it's in Trash). */
export async function findMembership(db: Database, boardId: string, userId: string) {
  const [row] = await db
    .select({ role: memberships.role, title: boards.title })
    .from(memberships)
    .innerJoin(boards, eq(boards.id, memberships.boardId))
    .where(
      and(
        eq(memberships.boardId, boardId),
        eq(memberships.userId, userId),
        isNull(boards.deletedAt),
      ),
    )
    .limit(1)
  return row ?? null
}
