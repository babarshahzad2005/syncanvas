import * as decoding from "lib0/decoding"
import * as encoding from "lib0/encoding"

// Presence on the wire (M2 spec: Presence transport). Clients speak y-protocols awareness:
// an update is a list of (clientID, clock, state as JSON). The board room only reads, checks,
// stamps, and re-encodes these entries; it never keeps them beyond memory.

/** Message types beside sync's 0, as in y-protocols. */
export const MESSAGE_AWARENESS = 1
export const MESSAGE_QUERY_AWARENESS = 3

/** Largest presence state accepted, in characters of JSON (a 100-id selection fits). */
export const PRESENCE_STATE_LIMIT = 8 * 1024

/**
 * The clock the board room uses to announce that someone left. Every connection gets a fresh
 * awareness id, so nothing ever needs to be newer than a removal.
 */
export const REMOVED_CLOCK = Number.MAX_SAFE_INTEGER

export type PresenceEntry = { clientId: number; clock: number; state: string }

/** The identity the board room vouches for, written over whatever a client claims. */
export type PresenceIdentity = { id: string; name: string; guest: boolean }

export function decodePresence(update: Uint8Array): PresenceEntry[] {
  const decoder = decoding.createDecoder(update)
  const count = decoding.readVarUint(decoder)
  const entries: PresenceEntry[] = []
  for (let i = 0; i < count; i++) {
    entries.push({
      clientId: decoding.readVarUint(decoder),
      clock: decoding.readVarUint(decoder),
      state: decoding.readVarString(decoder),
    })
  }
  return entries
}

export function encodePresence(entries: readonly PresenceEntry[]): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, entries.length)
  for (const entry of entries) {
    encoding.writeVarUint(encoder, entry.clientId)
    encoding.writeVarUint(encoder, entry.clock)
    encoding.writeVarString(encoder, entry.state)
  }
  return encoding.toUint8Array(encoder)
}

/** A whole socket message: the awareness message type, then the update. */
export function presenceMessage(entries: readonly PresenceEntry[]): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
  encoding.writeVarUint8Array(encoder, encodePresence(entries))
  return encoding.toUint8Array(encoder)
}

export function queryPresenceMessage(): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS)
  return encoding.toUint8Array(encoder)
}

/**
 * A client's state with the identity stamped over it, or "null" for a removal, or null when
 * the state isn't acceptable (too big, not JSON, not an object).
 */
export function stampPresence(state: string, identity: PresenceIdentity): string | null {
  if (state.length > PRESENCE_STATE_LIMIT) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(state)
  } catch {
    return null
  }
  if (parsed === null) return "null"
  if (typeof parsed !== "object" || Array.isArray(parsed)) return null
  return JSON.stringify({ ...(parsed as Record<string, unknown>), user: identity })
}
