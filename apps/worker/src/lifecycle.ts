import { canRename, normalizeBoardTitle } from "@syncanvas/shared"
import { and, eq } from "drizzle-orm"
import type { Database } from "./db/client"
import { boards, memberships } from "./db/schema"
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
