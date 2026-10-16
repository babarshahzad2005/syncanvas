import {
  type CommentView,
  type ControlMessage,
  canComment,
  displayNameOf,
  normalizeComment,
  type ThreadAnchor,
  type ThreadView,
} from "@syncanvas/shared"
import { and, asc, eq, inArray } from "drizzle-orm"
import type { Database } from "./db/client"
import { comments, threads, user } from "./db/schema"
import { type Caller, memberOrRefuse, refuse } from "./sharing"

// Threads and comments (M4; PRD A5, FLOWS §4). Postgres is their source of truth; the board
// room only relays them live. Every rule is checked here.

/** Relays a change to everyone on the Board (Durable Object RPC in production). */
export type Broadcast = (boardId: string, message: ControlMessage) => Promise<void>

const MAX_COORDINATE = 10_000_000
const COMMENT_RULES = "Only commenters, editors, and the owner can comment."

async function relay(broadcast: Broadcast, boardId: string, message: ControlMessage) {
  try {
    await broadcast(boardId, message)
  } catch (error) {
    // Postgres has it; others see it on their next load.
    console.error("Couldn't reach the board room:", error instanceof Error ? error.message : error)
  }
}

/** A valid anchor, or null: an Element id with a spot inside its box, or a point on the canvas. */
function parseAnchor(input: unknown): ThreadAnchor | null {
  if (typeof input !== "object" || input === null) return null
  const a = input as Record<string, unknown>
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
  if (typeof a.elementId === "string") {
    if (a.elementId.length === 0 || a.elementId.length > 100) return null
    if (!finite(a.fx) || !finite(a.fy)) return null
    const clamp = (v: number) => Math.min(1, Math.max(0, v))
    return { elementId: a.elementId, fx: clamp(a.fx), fy: clamp(a.fy) }
  }
  if (
    finite(a.x) &&
    finite(a.y) &&
    Math.abs(a.x) <= MAX_COORDINATE &&
    Math.abs(a.y) <= MAX_COORDINATE
  ) {
    return { x: a.x, y: a.y }
  }
  return null
}

function bodyOrRefuse(input: unknown) {
  const body = normalizeComment(input)
  if (!body) throw refuse(400, { error: "Comments are 1–2,000 characters." })
  return body
}

async function commenterOrRefuse(db: Database, boardId: string, caller: Caller) {
  const membership = await memberOrRefuse(db, boardId, caller)
  if (!canComment(membership.role)) throw refuse(403, { error: COMMENT_RULES })
  return membership
}

/** Threads with their comments, oldest comment first. */
async function views(db: Database, rows: (typeof threads.$inferSelect)[]): Promise<ThreadView[]> {
  if (rows.length === 0) return []
  const all = await db
    .select({
      id: comments.id,
      threadId: comments.threadId,
      body: comments.body,
      createdAt: comments.createdAt,
      editedAt: comments.editedAt,
      deletedAt: comments.deletedAt,
      authorId: user.id,
      authorName: user.name,
      authorEmail: user.email,
    })
    .from(comments)
    .leftJoin(user, eq(user.id, comments.authorId))
    .where(
      inArray(
        comments.threadId,
        rows.map((t) => t.id),
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id))
  const byThread = new Map<string, CommentView[]>()
  for (const c of all) {
    const list = byThread.get(c.threadId) ?? []
    const deleted = c.deletedAt !== null
    list.push({
      id: c.id,
      author:
        !deleted && c.authorId && c.authorEmail
          ? { id: c.authorId, name: displayNameOf({ name: c.authorName, email: c.authorEmail }) }
          : null,
      deleted,
      // A deleted comment's text never leaves the server.
      body: deleted ? "" : c.body,
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt?.toISOString() ?? null,
    })
    byThread.set(c.threadId, list)
  }
  return rows.map((t) => ({
    id: t.id,
    boardId: t.boardId,
    anchor:
      t.elementId !== null && t.fx !== null && t.fy !== null
        ? { elementId: t.elementId, fx: t.fx, fy: t.fy }
        : { x: t.x ?? 0, y: t.y ?? 0 },
    last: t.lastX !== null && t.lastY !== null ? { x: t.lastX, y: t.lastY } : null,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    comments: byThread.get(t.id) ?? [],
  }))
}

async function viewOf(db: Database, threadId: string): Promise<ThreadView> {
  const rows = await db.select().from(threads).where(eq(threads.id, threadId)).limit(1)
  const [view] = await views(db, rows)
  if (!view) throw refuse(404, { error: "That thread doesn't exist anymore." })
  return view
}

/** Every Thread on a Board. Access is checked by the caller (a Member, or a Guest's token). */
export async function listThreads(db: Database, boardId: string): Promise<ThreadView[]> {
  const rows = await db
    .select()
    .from(threads)
    .where(eq(threads.boardId, boardId))
    .orderBy(asc(threads.createdAt))
  return views(db, rows)
}

/** Lists a Board's Threads for one of its Members. */
export async function listThreadsFor(db: Database, boardId: string, caller: Caller) {
  await memberOrRefuse(db, boardId, caller)
  return listThreads(db, boardId)
}

/** A Commenter or above starts a Thread with its first comment. */
export async function createThread(
  db: Database,
  broadcast: Broadcast,
  input: { boardId: string; caller: Caller; anchor: unknown; body: unknown },
): Promise<ThreadView> {
  await commenterOrRefuse(db, input.boardId, input.caller)
  const anchor = parseAnchor(input.anchor)
  if (!anchor) throw refuse(400, { error: "A comment needs a place on the board." })
  const body = bodyOrRefuse(input.body)
  const id = crypto.randomUUID()
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(threads).values({
      id,
      boardId: input.boardId,
      ...("elementId" in anchor
        ? { elementId: anchor.elementId, fx: anchor.fx, fy: anchor.fy }
        : { x: anchor.x, y: anchor.y }),
      createdBy: input.caller.id,
      createdAt: now,
      updatedAt: now,
    })
    await tx.insert(comments).values({
      id: crypto.randomUUID(),
      threadId: id,
      authorId: input.caller.id,
      body,
      createdAt: now,
    })
  })
  const thread = await viewOf(db, id)
  await relay(broadcast, input.boardId, { type: "thread-added", thread })
  return thread
}

/** A Commenter or above replies in a Thread. */
export async function reply(
  db: Database,
  broadcast: Broadcast,
  input: { boardId: string; threadId: string; caller: Caller; body: unknown },
): Promise<ThreadView> {
  await commenterOrRefuse(db, input.boardId, input.caller)
  const body = bodyOrRefuse(input.body)
  const [thread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.id, input.threadId), eq(threads.boardId, input.boardId)))
    .limit(1)
  if (!thread) throw refuse(404, { error: "That thread doesn't exist anymore." })
  const now = new Date()
  await db
    .insert(comments)
    .values({ id: crypto.randomUUID(), threadId: thread.id, authorId: input.caller.id, body })
  await db.update(threads).set({ updatedAt: now }).where(eq(threads.id, thread.id))
  const view = await viewOf(db, thread.id)
  await relay(broadcast, input.boardId, { type: "thread-updated", thread: view })
  return view
}

// ---------- Managing Threads (M4 ticket 02) ----------

async function threadOrRefuse(db: Database, boardId: string, threadId: string) {
  const [thread] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.boardId, boardId)))
    .limit(1)
  if (!thread) throw refuse(404, { error: "That thread doesn't exist anymore." })
  return thread
}

async function commentOrRefuse(db: Database, threadId: string, commentId: string) {
  const [comment] = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, commentId), eq(comments.threadId, threadId)))
    .limit(1)
  if (!comment || comment.deletedAt) {
    throw refuse(404, { error: "That comment doesn't exist anymore." })
  }
  return comment
}

async function touched(db: Database, broadcast: Broadcast, boardId: string, threadId: string) {
  await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId))
  const thread = await viewOf(db, threadId)
  await relay(broadcast, boardId, { type: "thread-updated", thread })
  return thread
}

/** Authors edit their own comments, while they can still comment. */
export async function editComment(
  db: Database,
  broadcast: Broadcast,
  input: { boardId: string; threadId: string; commentId: string; caller: Caller; body: unknown },
): Promise<ThreadView> {
  await commenterOrRefuse(db, input.boardId, input.caller)
  const body = bodyOrRefuse(input.body)
  await threadOrRefuse(db, input.boardId, input.threadId)
  const comment = await commentOrRefuse(db, input.threadId, input.commentId)
  if (comment.authorId !== input.caller.id) {
    throw refuse(403, { error: "You can only edit your own comments." })
  }
  await db.update(comments).set({ body, editedAt: new Date() }).where(eq(comments.id, comment.id))
  return touched(db, broadcast, input.boardId, input.threadId)
}

/**
 * Deletes a comment: its author (while they can comment) or the Owner. A Thread's first
 * comment takes the whole Thread with it when nobody replied; with replies it stays as
 * "Comment deleted" (PRD A5). Returns the Thread, or null when it went too.
 */
export async function deleteComment(
  db: Database,
  broadcast: Broadcast,
  input: { boardId: string; threadId: string; commentId: string; caller: Caller },
): Promise<ThreadView | null> {
  const membership = await memberOrRefuse(db, input.boardId, input.caller)
  await threadOrRefuse(db, input.boardId, input.threadId)
  const comment = await commentOrRefuse(db, input.threadId, input.commentId)
  const isOwner = membership.role === "owner"
  const isAuthor = comment.authorId === input.caller.id && canComment(membership.role)
  if (!isOwner && !isAuthor) {
    throw refuse(403, { error: "Only the comment's author or the board's owner can delete it." })
  }
  const all = await db
    .select({ id: comments.id, deletedAt: comments.deletedAt })
    .from(comments)
    .where(eq(comments.threadId, input.threadId))
    .orderBy(asc(comments.createdAt), asc(comments.id))
  const first = all[0]?.id === comment.id
  const othersLeft = all.some((c) => c.id !== comment.id && !c.deletedAt)
  if (first && !othersLeft) {
    await removeThread(db, broadcast, input.boardId, input.threadId)
    return null
  }
  if (first) {
    await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, comment.id))
  } else {
    await db.delete(comments).where(eq(comments.id, comment.id))
    // The first comment was already deleted and this was the last reply: nothing is left.
    if (!othersLeft) {
      await removeThread(db, broadcast, input.boardId, input.threadId)
      return null
    }
  }
  return touched(db, broadcast, input.boardId, input.threadId)
}

async function removeThread(db: Database, broadcast: Broadcast, boardId: string, threadId: string) {
  await db.delete(threads).where(eq(threads.id, threadId))
  await relay(broadcast, boardId, { type: "thread-removed", threadId })
}

/** The Owner deletes a whole Thread. */
export async function deleteThread(
  db: Database,
  broadcast: Broadcast,
  input: { boardId: string; threadId: string; caller: Caller },
) {
  const membership = await memberOrRefuse(db, input.boardId, input.caller)
  if (membership.role !== "owner") {
    throw refuse(403, { error: "Only the board's owner can delete a thread." })
  }
  await threadOrRefuse(db, input.boardId, input.threadId)
  await removeThread(db, broadcast, input.boardId, input.threadId)
}

/** Commenters and above resolve or reopen any Thread. */
export async function setThreadStatus(
  db: Database,
  broadcast: Broadcast,
  input: { boardId: string; threadId: string; caller: Caller; status: "open" | "resolved" },
): Promise<ThreadView> {
  await commenterOrRefuse(db, input.boardId, input.caller)
  const thread = await threadOrRefuse(db, input.boardId, input.threadId)
  if (thread.status !== input.status) {
    await db.update(threads).set({ status: input.status }).where(eq(threads.id, thread.id))
  }
  return touched(db, broadcast, input.boardId, input.threadId)
}
