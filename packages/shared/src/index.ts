/** A Member's level of access on a Board (GLOSSARY: Role). */
export const ROLES = ["owner", "editor", "commenter", "viewer"] as const
export type Role = (typeof ROLES)[number]

/** Whether a Role may change Board content. Enforced on the server, mirrored in the UI. */
export function canEdit(role: Role): boolean {
  return role === "owner" || role === "editor"
}

/** One Board as the dashboard sees it (GET /api/dashboard). */
export type BoardSummary = {
  id: string
  title: string
  role: Role
  owner: { id: string; name: string; email: string }
  updatedAt: string
  thumbnailKey: string | null
}

export type DashboardResponse = { boards: BoardSummary[] }
export type CreateBoardResponse = { id: string; title: string }

export const BOARD_TITLE_MAX = 200

/** POST /api/boards/:id/token: a short-lived pass to that Board's live room. */
export type BoardTokenResponse = {
  token: string
  expiresAt: string
  role: Role
  board: { id: string; title: string }
  /** Who the token is for, as others will see them (M2: presence). */
  you: { id: string; name: string }
}

// ---------- Display names (M2 ticket 01) ----------

/** Longest display name, in characters. */
export const DISPLAY_NAME_MAX = 50

/**
 * A readable name guessed from an email, used as the prefill and whenever a User hasn't
 * chosen one: `ada.lovelace@…` → "Ada Lovelace", `jdoe84@…` → "Jdoe84". Plus-tags are
 * dropped. A local part with no letters or digits falls back to "Collaborator".
 */
export function nameFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").split("+")[0] ?? ""
  const words = local
    .split(/[._\-\s]+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .map((word) => word.charAt(0).toLocaleUpperCase() + word.slice(1))
  return words.join(" ").slice(0, DISPLAY_NAME_MAX).trim() || "Collaborator"
}

/** A display name as stored: trimmed, inner spaces collapsed, 1–50 characters; else null. */
export function normalizeDisplayName(input: unknown): string | null {
  if (typeof input !== "string") return null
  const name = input.trim().replace(/\s+/g, " ")
  return name.length >= 1 && name.length <= DISPLAY_NAME_MAX ? name : null
}

/** The name others see: the User's chosen name, or the prefill from their email until then. */
export function displayNameOf(user: { name?: string | null; email: string }): string {
  return normalizeDisplayName(user.name ?? "") ?? nameFromEmail(user.email)
}

// ---------- Sharing (M3; PRD A4) ----------

/** Roles someone can be invited with: everything but Owner. */
export const INVITE_ROLES = ["editor", "commenter", "viewer"] as const
export type InviteRole = (typeof INVITE_ROLES)[number]

const RANK: Record<Role, number> = { owner: 3, editor: 2, commenter: 1, viewer: 0 }

/** The higher of two Roles. */
export function higherRole<R extends Role>(a: R, b: R): R {
  return RANK[a] >= RANK[b] ? a : b
}

/** Roles a Member may invite with: the Owner any, an Editor at their own Role or lower. */
export function invitableRoles(role: Role): InviteRole[] {
  return role === "owner" || role === "editor" ? [...INVITE_ROLES] : []
}

export const INVITATION_DAYS = 30
/** Invitation emails per User per day, and in total (Brevo sends 300 a day, ADR 0007). */
export const INVITES_PER_USER_PER_DAY = 20
export const INVITES_PER_DAY = 200
export const EMAIL_MAX = 254

/** A trimmed, lowercased email address, or null if it doesn't look like one. */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null
  const email = input.trim().toLowerCase()
  return email.length <= EMAIL_MAX && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

export type SharingMember = { id: string; name: string; email: string; role: Role }

export type PendingInvitation = {
  id: string
  email: string
  role: InviteRole
  invitedBy: { id: string; name: string }
  expiresAt: string
  canResend: boolean
  canCancel: boolean
}

/** GET /api/boards/:id/sharing: who has access, as one of the Board's Members sees it. */
export type SharingResponse = {
  board: { id: string; title: string }
  you: { id: string; role: Role }
  /** Roles you may invite with (empty: you can't invite). */
  canInvite: InviteRole[]
  /** Change Roles, remove Members, and manage the Share Link: the Owner only. */
  canManage: boolean
  members: SharingMember[]
  /** Pending, unexpired Invitations; only shown to those who can invite. */
  invitations: PendingInvitation[]
}

export type InviteRequest = { email: string; role: InviteRole }
/** "member": the address had an account and has access now. "invited": a pending Invitation. */
export type InviteResponse = { result: "member" | "invited" }
/** The body of a 429: what happened, and when sending works again. */
export type LimitError = { error: string; resetsAt: string }
