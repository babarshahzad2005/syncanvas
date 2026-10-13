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
