// Presence rules (M2 spec), pure so they're easy to test: colors, and turning the awareness
// states of every open tab into the list of people on a Board.

/** DESIGN.md `presence`: twelve saturated colors, separate from the Palette and the accent. */
export const PRESENCE_COLORS = [
  "#C62828", // red
  "#C2410C", // orange
  "#A16207", // amber
  "#4D7C0F", // lime
  "#15803D", // green
  "#0F766E", // teal
  "#0369A1", // sky
  "#1D4ED8", // blue
  "#7E22CE", // purple
  "#A21CAF", // fuchsia
  "#BE185D", // pink
  "#8B5E34", // brown
] as const
/** Guests are always this gray (DESIGN.md `presence.guest`). */
export const GUEST_COLOR = "#57534E"

/** The identity the board room stamps on every state (never what a client claims). */
export type PresenceUser = { id: string; name: string; guest: boolean }

/** One open tab's presence, as received. */
export type TabPresence = {
  /** The awareness id: new for every connection. */
  clientId: number
  user: PresenceUser
  state: Record<string, unknown>
}

/** One person on the Board, with every tab they have open. */
export type Collaborator = PresenceUser & { color: string; tabs: TabPresence[] }

/**
 * A User's color: the same on every Board and every device, from a hash of their id
 * (FNV-1a, so it's stable and spreads short ids well). Guests are always gray.
 */
export function presenceColor(userId: string, guest = false): string {
  if (guest) return GUEST_COLOR
  let hash = 0x811c9dc5
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return PRESENCE_COLORS[(hash >>> 0) % PRESENCE_COLORS.length] as string
}

/** Reads a received state: only states the board room stamped with an identity count. */
export function tabPresence(clientId: number, state: unknown): TabPresence | null {
  if (typeof state !== "object" || state === null) return null
  const { user, ...rest } = state as { user?: unknown }
  if (typeof user !== "object" || user === null) return null
  const { id, name, guest } = user as Record<string, unknown>
  if (typeof id !== "string" || typeof name !== "string") return null
  return { clientId, user: { id, name, guest: guest === true }, state: rest }
}

/**
 * Everyone on the Board but you: one entry per User however many tabs they have, in the
 * order they arrived. Your own other tabs aren't "someone else", so they're left out.
 */
export function collaborators(tabs: readonly TabPresence[], selfUserId: string): Collaborator[] {
  const byUser = new Map<string, Collaborator>()
  for (const tab of tabs) {
    if (tab.user.id === selfUserId) continue
    const known = byUser.get(tab.user.id)
    if (known) known.tabs.push(tab)
    else {
      byUser.set(tab.user.id, {
        ...tab.user,
        color: presenceColor(tab.user.id, tab.user.guest),
        tabs: [tab],
      })
    }
  }
  return [...byUser.values()]
}
