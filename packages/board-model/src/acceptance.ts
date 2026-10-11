import * as Y from "yjs"
import { validateBoardDoc } from "./model"

// The board room's rules for an incoming update (ADR 0006). Shared by the real room and the
// convergence suite's simulated server, so the simulation proves the rules that ship.

export type UpdateVerdict =
  /** Nothing new (e.g. a client replaying its local copy on reconnect): ignore it. */
  | "unchanged"
  /**
   * Depends on content the room hasn't received (lost with a dropped connection), so it
   * can't be checked whole. The client's resync after reconnecting resends all of it.
   */
  | "incomplete"
  /** The sender may not edit this Board. */
  | "read-only"
  /** Applying it would make the Board invalid. */
  | "invalid"
  /** Persist, apply, and broadcast it. */
  | "accepted"

function isEmptyUpdate(update: Uint8Array) {
  const { structs, ds } = Y.decodeUpdate(update)
  return structs.length === 0 && ds.clients.size === 0
}

/**
 * Decides what to do with `update` sent to a Board whose live document is `doc`. Never
 * changes `doc`: the update is tried on a scratch copy. Re-sending known content counts as
 * unchanged even from a read-only sender, so it's never treated as an edit attempt.
 */
export function checkUpdate(doc: Y.Doc, update: Uint8Array, mayEdit: boolean): UpdateVerdict {
  if (isEmptyUpdate(update)) return "unchanged"
  const scratch = new Y.Doc()
  Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc))
  Y.applyUpdate(scratch, update)
  if (Y.equalSnapshots(Y.snapshot(scratch), Y.snapshot(doc))) return "unchanged"
  if (!mayEdit) return "read-only"
  // Only part of it could be applied: judging that part alone could wrongly reject (or
  // accept) it. A Board that already had pending content (older rooms) is checked as before.
  if (scratch.store.pendingStructs !== null && doc.store.pendingStructs === null) {
    return "incomplete"
  }
  if (validateBoardDoc(scratch).length > 0) return "invalid"
  return "accepted"
}
