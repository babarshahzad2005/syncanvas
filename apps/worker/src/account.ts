import { displayNameOf } from "@syncanvas/shared"
import { and, eq, ne } from "drizzle-orm"
import type { Database } from "./db/client"
import { boards, memberships, user } from "./db/schema"
import { type DestroyRoom, purge } from "./lifecycle"
import { type ApplyAccess, type Caller, refuse } from "./sharing"
import type { AssetStore } from "./thumbnails"

// Deleting an account (M5a ticket 06; FLOWS §1 Delete an account).

/**
 * Deletes the caller's account after they typed DELETE. Every Board they own goes for good,
 * Trash or not (room storage and thumbnail first, as in Delete forever). Then the User row:
 * Memberships, Folders, Notifications, settings, sessions, and Thread participation cascade,
 * while their comments and Threads stay with no author ("Deleted user"). Boards they were a
 * Member of hear it like a Member leaving, so open connections close.
 */
export async function deleteAccount(
  db: Database,
  rooms: { destroy: DestroyRoom; applyAccess: ApplyAccess; assets: AssetStore },
  input: { caller: Caller; confirm: unknown },
) {
  if (input.confirm !== "DELETE") throw refuse(400, { error: "Type DELETE to confirm." })
  const owned = await db
    .select({ id: boards.id })
    .from(boards)
    .where(eq(boards.ownerId, input.caller.id))
  // If a room can't be reached this stops, and the account stays for another try.
  for (const { id } of owned) await purge(db, rooms.destroy, rooms.assets, id)

  const joined = await db
    .select({ boardId: memberships.boardId })
    .from(memberships)
    .where(and(eq(memberships.userId, input.caller.id), ne(memberships.role, "owner")))
  await db.delete(user).where(eq(user.id, input.caller.id))
  for (const { boardId } of joined) {
    try {
      await rooms.applyAccess(boardId, {
        userId: input.caller.id,
        role: null,
        by: displayNameOf(input.caller),
      })
    } catch (error) {
      // Deleted already; their board token is refused once it expires either way.
      console.error(
        "Couldn't reach the board room:",
        error instanceof Error ? error.message : error,
      )
    }
  }
  return { deletedBoards: owned.length }
}
