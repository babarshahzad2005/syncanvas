import {
  DIGEST_GAP_HOURS,
  DIGESTS_PER_DAY,
  displayNameOf,
  mentionedIds,
  plainComment,
  type UserSettings,
} from "@syncanvas/shared"
import { and, asc, count, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { Database } from "./db/client"
import {
  boards,
  comments,
  digestEmails,
  invitationEmails,
  invitations,
  memberships,
  notifications,
  user,
  userSettings,
} from "./db/schema"
import type { DigestItem, SendDigest } from "./email"
import { mentionViews } from "./notifications"

// Digest emails and cleanup (M4 ticket 04; PRD A5, FLOWS §5). Both run from cron triggers in
// the same Worker (ADR 0004) and take the time as a parameter, so tests can set it.

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** Notifications this new wait for the next run: they may still be read in the app. */
const MIN_AGE = HOUR
const ITEMS_SHOWN = 20

// ---------- Settings and unsubscribe ----------

export async function settingsOf(db: Database, userId: string): Promise<UserSettings> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1)
  return { digestEnabled: row?.digestEnabled ?? true }
}

export async function setDigestEnabled(db: Database, userId: string, digestEnabled: boolean) {
  await db
    .insert(userSettings)
    .values({ userId, digestEnabled })
    .onConflictDoUpdate({ target: userSettings.userId, set: { digestEnabled } })
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`unsubscribe:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  )
}

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

function fromBase64Url(text: string): Uint8Array | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"))
    return Uint8Array.from(binary, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

/** The one-click unsubscribe link for a User: signed, so nobody can turn off someone else's. */
export async function unsubscribeUrl(appUrl: string, secret: string, userId: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    new TextEncoder().encode(userId),
  )
  const query = new URLSearchParams({ u: userId, t: toBase64Url(signature) })
  return `${appUrl}/api/unsubscribe?${query}`
}

/** Whether an unsubscribe link's signature is the server's own, for that User. */
export async function verifyUnsubscribe(secret: string, userId: string, token: string) {
  const signature = fromBase64Url(token)
  if (!userId || !signature) return false
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    signature,
    new TextEncoder().encode(userId),
  )
}

// ---------- Digest ----------

/**
 * One digest per User with Notifications that are unread, not yet emailed, and over an hour
 * old, on Boards they can still open: at most one per User every 3 hours, 50 a day in total
 * (UTC days, like Brevo's quota). Sent Notifications are marked emailed, so nothing goes twice.
 */
export async function runDigest(
  db: Database,
  send: SendDigest,
  options: { appUrl: string; secret: string; now?: Date },
) {
  const now = options.now ?? new Date()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const [sentToday] = await db
    .select({ n: count() })
    .from(digestEmails)
    .where(gte(digestEmails.sentAt, dayStart))
  let budget = DIGESTS_PER_DAY - (sentToday?.n ?? 0)
  if (budget <= 0) return { sent: 0 }

  const actor = alias(user, "actor")
  const rows = await db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      email: user.email,
      kind: notifications.kind,
      boardId: boards.id,
      boardTitle: boards.title,
      threadId: notifications.threadId,
      body: comments.body,
      deletedAt: comments.deletedAt,
      actorName: actor.name,
      actorEmail: actor.email,
    })
    .from(notifications)
    .innerJoin(user, eq(user.id, notifications.userId))
    .innerJoin(boards, eq(boards.id, notifications.boardId))
    .innerJoin(
      memberships,
      and(
        eq(memberships.boardId, notifications.boardId),
        eq(memberships.userId, notifications.userId),
      ),
    )
    .innerJoin(comments, eq(comments.id, notifications.commentId))
    .leftJoin(actor, eq(actor.id, notifications.actorId))
    .leftJoin(userSettings, eq(userSettings.userId, notifications.userId))
    .where(
      and(
        isNull(notifications.readAt),
        isNull(notifications.emailedAt),
        lte(notifications.createdAt, new Date(now.getTime() - MIN_AGE)),
        isNull(boards.deletedAt),
        sql`coalesce(${userSettings.digestEnabled}, true)`,
        or(
          isNull(userSettings.lastDigestAt),
          lte(userSettings.lastDigestAt, new Date(now.getTime() - DIGEST_GAP_HOURS * HOUR)),
        ),
      ),
    )
    .orderBy(asc(notifications.createdAt))

  // Oldest waiting first, so nobody is skipped day after day when the budget runs out.
  const byUser = new Map<string, typeof rows>()
  for (const row of rows) byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row])

  let sent = 0
  for (const [userId, pending] of byUser) {
    if (budget <= 0) break
    const newestFirst = [...pending].reverse()
    const shown = newestFirst.slice(0, ITEMS_SHOWN)
    const items: DigestItem[] = []
    for (const n of shown) {
      const mentions = await mentionViews(db, n.boardId, mentionedIds(n.body))
      const who = n.actorEmail
        ? displayNameOf({ name: n.actorName, email: n.actorEmail })
        : "Someone"
      items.push({
        headline: `${who} ${n.kind === "mention" ? "mentioned you" : "replied"}`,
        boardTitle: n.boardTitle,
        excerpt: n.deletedAt
          ? "Comment deleted"
          : (plainComment(n.body, mentions).split("\n")[0] ?? "").slice(0, 200),
        url: `${options.appUrl}/b/${encodeURIComponent(n.boardId)}?thread=${encodeURIComponent(n.threadId)}`,
      })
    }
    try {
      await send({
        email: pending[0]?.email ?? "",
        items,
        more: pending.length - shown.length,
        unsubscribeUrl: await unsubscribeUrl(options.appUrl, options.secret, userId),
      })
    } catch (error) {
      // Leave them unemailed for the next run; don't spend the budget.
      console.error("Digest email failed:", error instanceof Error ? error.message : error)
      continue
    }
    await db
      .update(notifications)
      .set({ emailedAt: now })
      .where(
        inArray(
          notifications.id,
          pending.map((n) => n.id),
        ),
      )
    await db
      .insert(userSettings)
      .values({ userId, lastDigestAt: now })
      .onConflictDoUpdate({ target: userSettings.userId, set: { lastDigestAt: now } })
    await db.insert(digestEmails).values({ id: crypto.randomUUID(), userId, sentAt: now })
    budget--
    sent++
  }
  return { sent }
}

// ---------- Cleanup ----------

/**
 * The daily cleanup (FLOWS §5): Notifications older than 90 days, expired Invitations, and
 * email logs older than two days (the limits only look at today).
 */
export async function runCleanup(db: Database, now: Date = new Date()) {
  await db
    .delete(notifications)
    .where(lt(notifications.createdAt, new Date(now.getTime() - 90 * DAY)))
  await db.delete(invitations).where(lt(invitations.expiresAt, now))
  const logs = new Date(now.getTime() - 2 * DAY)
  await db.delete(invitationEmails).where(lt(invitationEmails.sentAt, logs))
  await db.delete(digestEmails).where(lt(digestEmails.sentAt, logs))
}
