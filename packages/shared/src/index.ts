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
}
