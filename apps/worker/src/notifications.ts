import {
  displayNameOf,
  MENTION_PATTERN,
  type MentionView,
  mentionedIds,
  type NotificationsResponse,
  plainComment,
} from "@syncanvas/shared"
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm"
import type { Database } from "./db/client"
import { boards, comments, memberships, notifications, threadParticipants, user } from "./db/schema"
import { type Caller, refuse } from "./sharing"
import type { Broadcast } from "./threads"

// Mentions and Notifications (M4 ticket 03; PRD A5, FLOWS §4 "Mentions and reply
// Notifications"). A Mention is `<@userId>` in a comment's body; only the Board's Members can
// be mentioned. Notifications go to the mentioned, and on a reply to everyone following the
// Thread, never to the author.

const LIST_LIMIT = 50

/** Names for mentioned Users, and whether each is still a Member of the Board. */
export async function mentionViews(
  db: Database,
  boardId: string,
  ids: readonly string[],
): Promise<MentionView[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email, member: memberships.userId })
    .from(user)
    .leftJoin(memberships, and(eq(memberships.userId, user.id), eq(memberships.boardId, boardId)))
    .where(inArray(user.id, [...ids]))
  return rows.map((r) => ({ id: r.id, name: displayNameOf(r), member: r.member !== null }))
}

/**
 * A comment body as stored: Mentions of the Board's Members stay as `<@id>`; anyone else
 * becomes plain text ("@Name", or nothing for an unknown id). Returns who is mentioned.
 */
export async function withValidMentions(db: Database, boardId: string, body: string) {
  const views = await mentionViews(db, boardId, mentionedIds(body))
  const cleaned = body.replace(MENTION_PATTERN, (token, id: string) => {
    const view = views.find((v) => v.id === id)
    if (!view) return ""
    return view.member ? token : `@${view.name}`
  })
  return { body: cleaned, mentioned: views.filter((v) => v.member).map((v) => v.id) }
}

/**
 * After a comment is posted (or edited with new Mentions): notify the mentioned, and on a
 * reply everyone following the Thread, never the author; then they all follow it.
 */
export async function notifyForComment(
  db: Database,
  broadcast: Broadcast,
  input: {
    boardId: string
    threadId: string
    commentId: string
    authorId: string
    mentioned: readonly string[]
    /** A reply notifies the Thread's followers; a first comment or an edit doesn't. */
    isReply: boolean
  },
) {
  const mentioned = new Set(input.mentioned.filter((id) => id !== input.authorId))
  const replyTo = new Set<string>()
  if (input.isReply) {
    const followers = await db
      .select({ userId: threadParticipants.userId })
      .from(threadParticipants)
      .innerJoin(
        memberships,
        and(
          eq(memberships.userId, threadParticipants.userId),
          eq(memberships.boardId, input.boardId),
        ),
      )
      .where(eq(threadParticipants.threadId, input.threadId))
    for (const { userId } of followers) {
      if (userId !== input.authorId && !mentioned.has(userId)) replyTo.add(userId)
    }
  }
  const rows = [
    ...[...mentioned].map((userId) => ({ userId, kind: "mention" as const })),
    ...[...replyTo].map((userId) => ({ userId, kind: "reply" as const })),
  ].map((n) => ({
    id: crypto.randomUUID(),
    ...n,
    boardId: input.boardId,
    threadId: input.threadId,
    commentId: input.commentId,
    actorId: input.authorId,
  }))
  if (rows.length > 0) await db.insert(notifications).values(rows)
  await db
    .insert(threadParticipants)
    .values([input.authorId, ...mentioned].map((userId) => ({ threadId: input.threadId, userId })))
    .onConflictDoNothing()
  if (rows.length > 0) {
    try {
      await broadcast(input.boardId, { type: "notify", userIds: rows.map((r) => r.userId) })
    } catch (error) {
      // They see it on their next check (every 30 s).
      console.error(
        "Couldn't reach the board room:",
        error instanceof Error ? error.message : error,
      )
    }
  }
}

/** Only Notifications for Boards the User can still open (not in Trash, still a Member). */
function visibleTo(userId: string) {
  return and(eq(notifications.userId, userId), isNull(boards.deletedAt))
}

async function unreadCount(db: Database, userId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .innerJoin(boards, eq(boards.id, notifications.boardId))
    .innerJoin(
      memberships,
      and(eq(memberships.boardId, notifications.boardId), eq(memberships.userId, userId)),
    )
    .where(and(visibleTo(userId), isNull(notifications.readAt)))
  return row?.n ?? 0
}

/** A User's Notifications, newest first, and how many are unread. */
export async function listNotifications(
  db: Database,
  caller: Caller,
): Promise<NotificationsResponse> {
  const actor = { id: user.id, name: user.name, email: user.email }
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      boardId: boards.id,
      boardTitle: boards.title,
      threadId: notifications.threadId,
      body: comments.body,
      deletedAt: comments.deletedAt,
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .innerJoin(boards, eq(boards.id, notifications.boardId))
    .innerJoin(
      memberships,
      and(eq(memberships.boardId, notifications.boardId), eq(memberships.userId, caller.id)),
    )
    .innerJoin(comments, eq(comments.id, notifications.commentId))
    .leftJoin(user, eq(user.id, notifications.actorId))
    .where(visibleTo(caller.id))
    .orderBy(desc(notifications.createdAt))
    .limit(LIST_LIMIT)

  const byBoard = new Map<string, string[]>()
  for (const r of rows) {
    byBoard.set(r.boardId, [...(byBoard.get(r.boardId) ?? []), ...mentionedIds(r.body)])
  }
  const mentions = new Map<string, MentionView[]>()
  for (const [boardId, ids] of byBoard) {
    mentions.set(boardId, await mentionViews(db, boardId, [...new Set(ids)]))
  }
  return {
    unread: await unreadCount(db, caller.id),
    notifications: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      board: { id: r.boardId, title: r.boardTitle },
      threadId: r.threadId,
      actor:
        r.actorId && r.actorEmail
          ? { id: r.actorId, name: displayNameOf({ name: r.actorName, email: r.actorEmail }) }
          : null,
      excerpt: r.deletedAt
        ? "Comment deleted"
        : (plainComment(r.body, mentions.get(r.boardId) ?? []).split("\n")[0] ?? "").slice(0, 140),
      createdAt: r.createdAt.toISOString(),
      read: r.readAt !== null,
    })),
  }
}

export async function unreadFor(db: Database, caller: Caller) {
  return { unread: await unreadCount(db, caller.id) }
}

/** Marks one of the caller's Notifications read. */
export async function markRead(db: Database, caller: Caller, id: string) {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, caller.id)))
    .returning({ id: notifications.id })
  if (updated.length === 0) throw refuse(404, { error: "That notification doesn't exist." })
}

/** Marks every one of the caller's Notifications read. */
export async function markAllRead(db: Database, caller: Caller) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, caller.id), isNull(notifications.readAt)))
}
