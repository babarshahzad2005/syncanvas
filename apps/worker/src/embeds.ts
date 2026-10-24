import type { EmbedState } from "@syncanvas/shared"
import { and, eq, isNull } from "drizzle-orm"
import type { Database } from "./db/client"
import { boards, embeds } from "./db/schema"
import { type Caller, memberOrRefuse, NO_LINK, newLinkToken, refuse, tellRoom } from "./sharing"

// The Embed (M6 ticket 05; PRD A8, GLOSSARY: Embed): a live, read-only view of a Board on
// another website, with its own token. Only the Owner switches it; the Share Link doesn't
// affect it, and it doesn't affect the Share Link.

/** Closes every Embed viewer on a Board, and refuses the board tokens they hold (board room). */
export type CloseEmbeds = (boardId: string) => Promise<void>

async function ownerOrRefuse(db: Database, boardId: string, caller: Caller) {
  const membership = await memberOrRefuse(db, boardId, caller)
  if (membership.role !== "owner") {
    throw refuse(403, { error: "Only the owner can embed this board." })
  }
}

/**
 * Turns the Embed on with a new token (the Owner only). If it was already on, the old
 * snippet stops working and its viewers are closed.
 */
export async function enableEmbed(
  db: Database,
  closeEmbeds: CloseEmbeds,
  input: { boardId: string; caller: Caller },
): Promise<EmbedState> {
  await ownerOrRefuse(db, input.boardId, input.caller)
  const token = newLinkToken()
  const [old] = await db
    .select({ token: embeds.token })
    .from(embeds)
    .where(eq(embeds.boardId, input.boardId))
    .limit(1)
  await db
    .insert(embeds)
    .values({ boardId: input.boardId, token, createdBy: input.caller.id })
    .onConflictDoUpdate({
      target: embeds.boardId,
      set: { token, createdBy: input.caller.id, createdAt: new Date() },
    })
  if (old) await tellRoom(() => closeEmbeds(input.boardId))
  return { token }
}

/** Turns the Embed off: every site showing it stops at once (the Owner only). */
export async function disableEmbed(
  db: Database,
  closeEmbeds: CloseEmbeds,
  input: { boardId: string; caller: Caller },
) {
  await ownerOrRefuse(db, input.boardId, input.caller)
  const removed = await db
    .delete(embeds)
    .where(eq(embeds.boardId, input.boardId))
    .returning({ token: embeds.token })
  if (removed.length > 0) await tellRoom(() => closeEmbeds(input.boardId))
}

/**
 * The Board behind an Embed token, if it's on and the Board isn't in Trash. Every other case
 * gets the same answer as a bad Share Link, so tokens can't be probed.
 */
export async function liveEmbed(db: Database, token: string) {
  const [row] = token
    ? await db
        .select({ boardId: boards.id, title: boards.title })
        .from(embeds)
        .innerJoin(boards, eq(boards.id, embeds.boardId))
        .where(and(eq(embeds.token, token), isNull(boards.deletedAt)))
        .limit(1)
    : []
  if (!row) throw refuse(403, { error: NO_LINK })
  return row
}
