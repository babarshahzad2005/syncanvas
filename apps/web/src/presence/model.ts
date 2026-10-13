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

// ---------- Cursors and away (M2 ticket 03) ----------

/** No pointer or keyboard input for this long marks a tab away. */
export const IDLE_AWAY_MS = 60_000

/** Where a tab's cursor is, in world units, or null when it isn't over the Board. */
export function cursorOf(tab: TabPresence): { x: number; y: number } | null {
  const cursor = tab.state.cursor as { x?: unknown; y?: unknown } | null | undefined
  if (!cursor || typeof cursor.x !== "number" || typeof cursor.y !== "number") return null
  if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return null
  if (tab.state.away === true) return null
  return { x: cursor.x, y: cursor.y }
}

/** A tab is away when it's hidden, or hasn't had input for IDLE_AWAY_MS. */
export function tabIsAway(hidden: boolean, lastInputAt: number, now: number): boolean {
  return hidden || now - lastInputAt >= IDLE_AWAY_MS
}

/** A person is away only when every tab they have open is. */
export function isAway(person: Pick<Collaborator, "tabs">): boolean {
  return person.tabs.length > 0 && person.tabs.every((tab) => tab.state.away === true)
}

// ---------- Selections (M2 ticket 04) ----------

/** Selections up to this many Elements are published as ids; larger ones as their box. */
export const SELECTION_IDS_MAX = 100

type Box = { x: number; y: number; w: number; h: number }
export type PublishedSelection = { ids: string[] } | { box: Box } | null

/** What a tab publishes about its selection; `boxOf` measures a large one. */
export function publishedSelection(
  ids: readonly string[],
  boxOf: (ids: readonly string[]) => Box | null,
): PublishedSelection {
  if (ids.length === 0) return null
  if (ids.length <= SELECTION_IDS_MAX) return { ids: [...ids] }
  const box = boxOf(ids)
  return box ? { box } : null
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)

/** Reads a tab's selection from its (untrusted) presence state. */
export function selectionOf(tab: TabPresence): { ids?: string[]; box?: Box } | null {
  const selection = tab.state.selection as { ids?: unknown; box?: unknown } | null | undefined
  if (!selection || typeof selection !== "object") return null
  if (Array.isArray(selection.ids)) {
    const ids = selection.ids
      .slice(0, SELECTION_IDS_MAX)
      .filter((id): id is string => typeof id === "string")
    return ids.length > 0 ? { ids } : null
  }
  const box = selection.box as Record<string, unknown> | undefined
  if (box && finite(box.x) && finite(box.y) && finite(box.w) && finite(box.h)) {
    return { box: { x: box.x, y: box.y, w: box.w, h: box.h } }
  }
  return null
}
