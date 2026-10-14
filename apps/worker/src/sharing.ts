import {
  displayNameOf,
  INVITATION_DAYS,
  INVITE_ROLES,
  INVITES_PER_DAY,
  INVITES_PER_USER_PER_DAY,
  type InviteResponse,
  invitableRoles,
  type LimitError,
  normalizeEmail,
  type Role,
  type SharingResponse,
} from "@syncanvas/shared"
import { and, asc, count, eq, gt, gte } from "drizzle-orm"
import { HTTPException } from "hono/http-exception"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { AccessChange } from "./board-room"
import { findMembership } from "./boards"
import type { Database } from "./db/client"
import { invitationEmails, invitations, memberships, user } from "./db/schema"
import type { SendInvitation } from "./email"

// Sharing (M3; PRD A4): who has access to a Board, Invitations, and their daily limits.
// Every rule is checked here, on the server; the Share dialog only mirrors them.

export type Caller = { id: string; email: string; name: string }

const DAY = 24 * 60 * 60 * 1000
const NO_ACCESS = "You don't have access to this board."

/** Stops the request with a JSON error body (Hono turns it into the response). */
function refuse(status: ContentfulStatusCode, body: { error: string } & Record<string, unknown>) {
  return new HTTPException(status, { res: Response.json(body, { status }) })
}

/** The caller's Membership, or the same 403 for "no such Board" and "not a Member". */
async function memberOrRefuse(db: Database, boardId: string, caller: Caller) {
  const membership = await findMembership(db, boardId, caller.id)
  if (!membership) throw refuse(403, { error: NO_ACCESS })
  return membership
}

/** Everyone with access, and the pending Invitations if the caller can invite. */
export async function sharingState(
  db: Database,
  boardId: string,
  caller: Caller,
): Promise<SharingResponse> {
  const membership = await memberOrRefuse(db, boardId, caller)
  const canInvite = invitableRoles(membership.role)
  const isOwner = membership.role === "owner"

  const memberRows = await db
    .select({ id: user.id, name: user.name, email: user.email, role: memberships.role })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(memberships.boardId, boardId))
  const rank: Record<Role, number> = { owner: 0, editor: 1, commenter: 2, viewer: 3 }
  const members = memberRows
    .map((m) => ({ ...m, name: displayNameOf(m) }))
    .sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name))

  const pending =
    canInvite.length === 0
      ? []
      : await db
          .select({
            id: invitations.id,
            email: invitations.email,
            role: invitations.role,
            invitedById: user.id,
            invitedByName: user.name,
            invitedByEmail: user.email,
            expiresAt: invitations.expiresAt,
          })
          .from(invitations)
          .innerJoin(user, eq(user.id, invitations.invitedBy))
          .where(and(eq(invitations.boardId, boardId), gt(invitations.expiresAt, new Date())))
          .orderBy(asc(invitations.createdAt))

  return {
    board: { id: boardId, title: membership.title },
    you: { id: caller.id, role: membership.role },
    canInvite,
    canManage: isOwner,
    members,
    invitations: pending.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      invitedBy: {
        id: i.invitedById,
        name: displayNameOf({ name: i.invitedByName, email: i.invitedByEmail }),
      },
      expiresAt: i.expiresAt.toISOString(),
      canResend: isOwner,
      canCancel: isOwner || i.invitedById === caller.id,
    })),
  }
}

/**
 * Refuses when sending one more invitation email would pass a daily limit: 20 for the caller,
 * 200 for everyone. Days are UTC days, like Brevo's own daily quota.
 */
async function checkLimits(db: Database, senderId: string) {
  const now = new Date()
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const resetsAt = new Date(dayStart.getTime() + DAY).toISOString()
  const [mine] = await db
    .select({ n: count() })
    .from(invitationEmails)
    .where(and(eq(invitationEmails.senderId, senderId), gte(invitationEmails.sentAt, dayStart)))
  if ((mine?.n ?? 0) >= INVITES_PER_USER_PER_DAY) {
    const body: LimitError = {
      error: `You've sent ${INVITES_PER_USER_PER_DAY} invitations today, the most for one day.`,
      resetsAt,
    }
    throw refuse(429, body)
  }
  const [all] = await db
    .select({ n: count() })
    .from(invitationEmails)
    .where(gte(invitationEmails.sentAt, dayStart))
  if ((all?.n ?? 0) >= INVITES_PER_DAY) {
    const body: LimitError = {
      error: "Syncanvas has sent all the invitations it can for today.",
      resetsAt,
    }
    throw refuse(429, body)
  }
}

type SendContext = { send: SendInvitation; appUrl: string }

async function sendAndLog(
  db: Database,
  { send, appUrl }: SendContext,
  message: Omit<Parameters<SendInvitation>[0], "url"> & { boardId: string; senderId: string },
) {
  const { boardId, senderId, ...rest } = message
  try {
    await send({ ...rest, url: `${appUrl}/b/${encodeURIComponent(boardId)}` })
  } catch (error) {
    console.error("Invitation email failed:", error instanceof Error ? error.message : error)
    throw refuse(502, { error: "Couldn't send the email. Try again in a moment." })
  }
  await db.insert(invitationEmails).values({ id: crypto.randomUUID(), senderId })
}

/**
 * Invites an email to a Board with a Role (PRD A4: the Owner, or an Editor at their own Role
 * or lower). Someone with an account becomes a Member at once; an unknown address gets a
 * pending Invitation (inviting it again updates and resends it). Either way an email goes out.
 */
export async function invite(
  db: Database,
  context: SendContext,
  input: { boardId: string; caller: Caller; email: unknown; role: unknown },
): Promise<InviteResponse> {
  const { boardId, caller } = input
  const membership = await memberOrRefuse(db, boardId, caller)
  const allowed = invitableRoles(membership.role)
  if (allowed.length === 0) {
    throw refuse(403, { error: "Only the owner and editors can invite people." })
  }
  const email = normalizeEmail(input.email)
  if (!email) throw refuse(400, { error: "Enter a valid email address." })
  const role = allowed.find((r) => r === input.role)
  if (!role) throw refuse(400, { error: "Pick a role: editor, commenter, or viewer." })

  const [existing] = await db.select().from(user).where(eq(user.email, email)).limit(1)
  if (existing && (await findMembership(db, boardId, existing.id))) {
    // Inviting never changes an existing Member's Role; the Owner does that in the list.
    const who =
      existing.id === caller.id ? "You already have" : `${displayNameOf(existing)} already has`
    throw refuse(409, { error: `${who} access to this board.` })
  }
  await checkLimits(db, caller.id)

  const message = {
    boardId,
    senderId: caller.id,
    email,
    inviter: displayNameOf(caller),
    boardTitle: membership.title,
    role,
  }
  if (existing) {
    await db
      .insert(memberships)
      .values({ boardId, userId: existing.id, role, via: "invitation" })
      .onConflictDoNothing()
    await sendAndLog(db, context, { ...message, kind: "shared" })
    return { result: "member" }
  }
  const now = new Date()
  const expiresAt = new Date(now.getTime() + INVITATION_DAYS * DAY)
  await db
    .insert(invitations)
    .values({ id: crypto.randomUUID(), boardId, email, role, invitedBy: caller.id, expiresAt })
    .onConflictDoUpdate({
      target: [invitations.boardId, invitations.email],
      set: { role, invitedBy: caller.id, createdAt: now, expiresAt, lastSentAt: now },
    })
  await sendAndLog(db, context, { ...message, kind: "invitation" })
  return { result: "invited" }
}

async function findInvitation(db: Database, boardId: string, invitationId: string) {
  const [row] = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.id, invitationId), eq(invitations.boardId, boardId)))
    .limit(1)
  if (!row) throw refuse(404, { error: "That invitation isn't pending anymore." })
  return row
}

/** Sends a pending Invitation again, for another 30 days (the Owner only). */
export async function resendInvitation(
  db: Database,
  context: SendContext,
  input: { boardId: string; invitationId: string; caller: Caller },
) {
  const membership = await memberOrRefuse(db, input.boardId, input.caller)
  if (membership.role !== "owner") {
    throw refuse(403, { error: "Only the owner can resend invitations." })
  }
  const invitation = await findInvitation(db, input.boardId, input.invitationId)
  await checkLimits(db, input.caller.id)
  const now = new Date()
  await db
    .update(invitations)
    .set({ lastSentAt: now, expiresAt: new Date(now.getTime() + INVITATION_DAYS * DAY) })
    .where(eq(invitations.id, invitation.id))
  await sendAndLog(db, context, {
    boardId: input.boardId,
    senderId: input.caller.id,
    email: invitation.email,
    kind: "invitation",
    inviter: displayNameOf(input.caller),
    boardTitle: membership.title,
    role: invitation.role,
  })
}

/** Cancels a pending Invitation: the Owner any, an Editor the ones they sent. */
export async function cancelInvitation(
  db: Database,
  input: { boardId: string; invitationId: string; caller: Caller },
) {
  const membership = await memberOrRefuse(db, input.boardId, input.caller)
  const invitation = await findInvitation(db, input.boardId, input.invitationId)
  const mayCancel =
    membership.role === "owner" ||
    (membership.role === "editor" && invitation.invitedBy === input.caller.id)
  if (!mayCancel) throw refuse(403, { error: "Only the owner can cancel this invitation." })
  await db.delete(invitations).where(eq(invitations.id, invitation.id))
}

/**
 * A new User's first sign-in: their unexpired Invitations become Memberships. Every
 * Invitation for the address goes, since later ones reach the account directly.
 */
export async function convertInvitations(db: Database, newUser: { id: string; email: string }) {
  const email = newUser.email.toLowerCase()
  const pending = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.email, email), gt(invitations.expiresAt, new Date())))
  if (pending.length > 0) {
    await db
      .insert(memberships)
      .values(
        pending.map((i) => ({
          boardId: i.boardId,
          userId: newUser.id,
          role: i.role,
          via: "invitation" as const,
        })),
      )
      .onConflictDoNothing()
  }
  await db.delete(invitations).where(eq(invitations.email, email))
}

// ---------- Changing access (M3 ticket 02) ----------

/** Tells a Board's live room about a saved change (Durable Object RPC in production). */
export type ApplyAccess = (boardId: string, change: AccessChange) => Promise<void>

async function pushToRoom(applyAccess: ApplyAccess, boardId: string, change: AccessChange) {
  try {
    await applyAccess(boardId, change)
  } catch (error) {
    // Postgres already holds the change; the next board token carries it either way.
    console.error("Couldn't reach the board room:", error instanceof Error ? error.message : error)
  }
}

async function targetMember(db: Database, boardId: string, userId: string) {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.boardId, boardId), eq(memberships.userId, userId)))
    .limit(1)
  if (!row) throw refuse(404, { error: "That person doesn't have access anymore." })
  if (row.role === "owner") throw refuse(400, { error: "The owner's access can't change." })
  return row
}

/** The Owner changes a Member's Role (never to or from Owner). */
export async function changeRole(
  db: Database,
  applyAccess: ApplyAccess,
  input: { boardId: string; caller: Caller; userId: string; role: unknown },
) {
  const membership = await memberOrRefuse(db, input.boardId, input.caller)
  if (membership.role !== "owner") {
    throw refuse(403, { error: "Only the owner can change roles." })
  }
  const role = INVITE_ROLES.find((r) => r === input.role)
  if (!role) throw refuse(400, { error: "Pick a role: editor, commenter, or viewer." })
  const current = await targetMember(db, input.boardId, input.userId)
  if (current.role === role) return
  await db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.boardId, input.boardId), eq(memberships.userId, input.userId)))
  await pushToRoom(applyAccess, input.boardId, {
    userId: input.userId,
    role,
    by: displayNameOf(input.caller),
  })
}

/**
 * Ends a Membership: the Owner removes someone, or a Member (never the Owner) leaves. Their
 * open connections close at once.
 */
export async function removeMember(
  db: Database,
  applyAccess: ApplyAccess,
  input: { boardId: string; caller: Caller; userId: string },
) {
  const membership = await memberOrRefuse(db, input.boardId, input.caller)
  const leaving = input.userId === input.caller.id
  if (leaving && membership.role === "owner") {
    throw refuse(400, { error: "The owner can't leave their own board." })
  }
  if (!leaving && membership.role !== "owner") {
    throw refuse(403, { error: "Only the owner can remove people." })
  }
  if (!leaving) await targetMember(db, input.boardId, input.userId)
  await db
    .delete(memberships)
    .where(and(eq(memberships.boardId, input.boardId), eq(memberships.userId, input.userId)))
  await pushToRoom(applyAccess, input.boardId, {
    userId: input.userId,
    role: null,
    by: displayNameOf(input.caller),
  })
}
