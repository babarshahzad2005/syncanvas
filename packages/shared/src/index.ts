/** A Member's level of access on a Board (GLOSSARY: Role). */
export const ROLES = ["owner", "editor", "commenter", "viewer"] as const
export type Role = (typeof ROLES)[number]

/** Whether a Role may change Board content. Enforced on the server, mirrored in the UI. */
export function canEdit(role: Role): boolean {
  return role === "owner" || role === "editor"
}
