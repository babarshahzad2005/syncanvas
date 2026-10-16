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
  /** The Share Link, shown to the Owner only (null: off, or not the Owner). */
  link: ShareLinkState | null
}

export type InviteRequest = { email: string; role: InviteRole }
/** "member": the address had an account and has access now. "invited": a pending Invitation. */
export type InviteResponse = { result: "member" | "invited" }
/** The body of a 429: what happened, and when sending works again. */
export type LimitError = { error: string; resetsAt: string }

/**
 * What the board room tells a User's open connections when the Owner changes their access
 * (M3 ticket 02): their new Role, or null when they were removed (or left), and who did it.
 */
export type AccessNotice = { role: Role | null; by: string }

/** PATCH /api/boards/:id/members/:userId (the Owner only). */
export type ChangeRoleRequest = { role: InviteRole }

// ---------- Share Link (M3 ticket 03) ----------

/** How long a Share Link lasts: null for never (the default), or days. */
export const LINK_EXPIRY_DAYS = [null, 1, 7, 30] as const
export type LinkExpiry = (typeof LINK_EXPIRY_DAYS)[number]

export type ShareLinkState = { token: string; role: InviteRole; expiresAt: string | null }

/**
 * PUT /api/boards/:id/share-link (the Owner only): turns the link on, or changes it. Missing
 * fields stay as they are (a new link is Viewer, never expiring). A new Role means a new token.
 */
export type ShareLinkRequest = { role?: InviteRole; expiresInDays?: LinkExpiry }

/** POST /api/boards/:id/join: become a Member through the Share Link. */
export type JoinRequest = { token: string }
export type JoinResponse = { role: Role }

/** The path a Share Link opens. */
export function shareLinkPath(boardId: string, token: string) {
  return `/b/${encodeURIComponent(boardId)}?s=${encodeURIComponent(token)}`
}

/**
 * POST /api/guest/boards/:id/token: a Guest's pass to a Board, from a valid Share Link and no
 * session (M3 ticket 04). Always view-only; `linkRole` picks the "Sign in to …" button.
 */
export type GuestTokenResponse = BoardTokenResponse & { linkRole: InviteRole }

// ---------- Comments (M4) ----------

/** Longest comment, in characters (PRD Limits). */
export const COMMENT_MAX = 2000

/** Whether a Role may write comments: Commenters and above (PRD A5). Guests never. */
export function canComment(role: Role): boolean {
  return role !== "viewer"
}

/**
 * Where a Thread's pin sits: on an Element, at a spot relative to its box (0–1 of its width
 * and height, so it moves and scales with it), or at a point on the canvas.
 */
export type ThreadAnchor = { elementId: string; fx: number; fy: number } | { x: number; y: number }

export type CommentView = {
  id: string
  /** Null for a deleted comment, or an account that's gone. */
  author: { id: string; name: string } | null
  /** A first comment deleted after others replied: it reads "Comment deleted" (PRD A5). */
  deleted: boolean
  /** Who `<@id>` in the body is: their current name, and whether they're still a Member. */
  mentions: MentionView[]
  body: string
  createdAt: string
  editedAt: string | null
}

export type ThreadView = {
  id: string
  boardId: string
  anchor: ThreadAnchor
  /** Where a deleted Element's pin was last (Detached Threads, M4 ticket 02). */
  last: { x: number; y: number } | null
  status: "open" | "resolved"
  createdAt: string
  comments: CommentView[]
}

export type ThreadsResponse = { threads: ThreadView[] }
export type CreateThreadRequest = { anchor: ThreadAnchor; body: string }
export type ReplyRequest = { body: string }

/** A box in world units. */
export type ElementBox = { x: number; y: number; w: number; h: number }

/**
 * What the board room sends everyone on the Board about comments (never Embed viewers). The
 * Thread changes come from the API; `element-gone` and `last-boxes` are the room's own: where
 * deleted Elements with Threads were, so their pins can stay there (ADR 0012).
 */
export type ControlMessage =
  | { type: "thread-added" | "thread-updated"; thread: ThreadView }
  | { type: "thread-removed"; threadId: string }
  | { type: "element-gone"; elementId: string; box: ElementBox }
  | { type: "last-boxes"; boxes: Record<string, ElementBox> }
  /** These Users have new Notifications (only their own sockets hear it, M4 ticket 03). */
  | { type: "notify"; userIds: string[] }

export type EditCommentRequest = { body: string }

/** A trimmed comment body, or null if it's empty or too long. */
export function normalizeComment(input: unknown): string | null {
  if (typeof input !== "string") return null
  const body = input.replace(/\r\n?/g, "\n").trim()
  return body.length >= 1 && body.length <= COMMENT_MAX ? body : null
}

// ---------- Mentions and Notifications (M4 ticket 03) ----------

/**
 * How a Mention is stored in a comment: `<@userId>`. It's shown with the person's current
 * name (PRD A5), highlighted while they're a Member of the Board and plain text after.
 */
export const MENTION_PATTERN = /<@([A-Za-z0-9_-]{1,64})>/g

export type MentionView = { id: string; name: string; member: boolean }

/** The User ids a comment mentions, each once. */
export function mentionedIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_PATTERN)].map((m) => m[1] as string))]
}

/** A comment as plain text: Mentions become "@Name" (unknown ones "@someone"). */
export function plainComment(body: string, mentions: readonly MentionView[]): string {
  return body.replace(MENTION_PATTERN, (_, id: string) => {
    const name = mentions.find((m) => m.id === id)?.name
    return `@${name ?? "someone"}`
  })
}

export type NotificationView = {
  id: string
  kind: "mention" | "reply"
  board: { id: string; title: string }
  threadId: string
  actor: { id: string; name: string } | null
  /** The comment's first line, as plain text. */
  excerpt: string
  createdAt: string
  read: boolean
}

/** GET /api/notifications: newest first (Boards you can't open are left out), and the unread count. */
export type NotificationsResponse = { notifications: NotificationView[]; unread: number }
