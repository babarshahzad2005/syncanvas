import type { BoardSummary } from "@syncanvas/shared"
import { and, desc, eq, isNull } from "drizzle-orm"
import type { Database } from "./db/client"
import { boards, memberships, user } from "./db/schema"

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

/** Every Board the User is a Member of (owned or shared), most recently updated first. */
export async function listBoards(db: Database, userId: string): Promise<BoardSummary[]> {
  const rows = await db
    .select({
      id: boards.id,
      title: boards.title,
      role: memberships.role,
      updatedAt: boards.updatedAt,
      thumbnailKey: boards.thumbnailKey,
      ownerId: user.id,
      ownerName: user.name,
      ownerEmail: user.email,
    })
    .from(memberships)
    .innerJoin(boards, eq(boards.id, memberships.boardId))
    .innerJoin(user, eq(user.id, boards.ownerId))
    .where(and(eq(memberships.userId, userId), isNull(boards.deletedAt)))
    .orderBy(desc(boards.updatedAt))

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    role: r.role,
    owner: { id: r.ownerId, name: r.ownerName, email: r.ownerEmail },
    updatedAt: r.updatedAt.toISOString(),
    thumbnailKey: r.thumbnailKey,
  }))
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
