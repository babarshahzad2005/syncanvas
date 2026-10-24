import * as Y from "yjs"
import { ELEMENT_CAP, readElement } from "./model"

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

const ELEMENTS = "elements"

function isEmptyUpdate(update: Uint8Array) {
  const { structs, ds } = Y.decodeUpdate(update)
  return structs.length === 0 && ds.clients.size === 0
}

function sameState(a: Map<number, number>, b: Map<number, number>) {
  if (a.size !== b.size) return false
  for (const [client, clock] of a) if (b.get(client) !== clock) return false
  return true
}

/**
 * Checks updates for one live document without ever changing it. Each update is tried on a
 * shadow copy kept in step with `doc` (it follows the doc's own updates), and only the
 * Elements the update touched are validated, so the cost follows the edit, not the Board
 * (M6 ticket 08b). A rejected or half-applicable update leaves the shadow out of step, so it's
 * dropped and rebuilt from `doc` on the next check; that's rare and costs one copy.
 */
export class UpdateChecker {
  private shadow: Y.Doc | null = null
  private readonly follow = (update: Uint8Array) => {
    if (this.shadow) Y.applyUpdate(this.shadow, update)
  }

  private readonly doc: Y.Doc
  private readonly elementCap: number

  /** `elementCap` is overridable for tests only. */
  constructor(doc: Y.Doc, elementCap = ELEMENT_CAP) {
    this.doc = doc
    this.elementCap = elementCap
  }

  /**
   * Decides what to do with `update`. Re-sending known content counts as unchanged even from
   * a read-only sender, so it's never treated as an edit attempt. After "accepted" the caller
   * applies the update to `doc`, which the shadow already holds.
   */
  check(update: Uint8Array, mayEdit: boolean): UpdateVerdict {
    if (isEmptyUpdate(update)) return "unchanged"
    const shadow = this.shadowDoc()
    // Applying can run more than one transaction (Y.Text tidies formatting in a second one).
    const transactions: Y.Transaction[] = []
    const record = (transaction: Y.Transaction) => {
      transactions.push(transaction)
    }
    shadow.on("afterTransaction", record)
    Y.applyUpdate(shadow, update)
    shadow.off("afterTransaction", record)
    const verdict = this.judge(shadow, transactions, mayEdit)
    // Only an accepted update (or nothing at all) keeps the shadow equal to the doc. Pending
    // content (an update whose dependencies never arrived) would also set it apart.
    const pending = shadow.store.pendingStructs !== null || shadow.store.pendingDs !== null
    if ((verdict !== "accepted" && verdict !== "unchanged") || pending) this.drop()
    return verdict
  }

  /** Stops following the doc. Call it when the doc is replaced or destroyed. */
  dispose() {
    this.drop()
  }

  private judge(shadow: Y.Doc, transactions: Y.Transaction[], mayEdit: boolean): UpdateVerdict {
    const first = transactions[0]
    const last = transactions.at(-1)
    if (!first || !last) return "unchanged"
    const deleted = transactions.some((t) => t.deleteSet.clients.size > 0)
    if (!deleted && sameState(first.beforeState, last.afterState)) return "unchanged"
    if (!mayEdit) return "read-only"
    // Only part of it could be applied: judging that part alone could wrongly reject (or
    // accept) it. A Board that already had pending content (older rooms) is checked as before.
    if (shadow.store.pendingStructs !== null && this.doc.store.pendingStructs === null) {
      return "incomplete"
    }
    return this.isValid(shadow, transactions) ? "accepted" : "invalid"
  }

  /** The whole-Board rules (`validateBoardDoc`), applied to what these transactions changed. */
  private isValid(shadow: Y.Doc, transactions: Y.Transaction[]) {
    for (const name of shadow.share.keys()) if (name !== ELEMENTS) return false
    const elements = shadow.getMap<unknown>(ELEMENTS)
    // Root types aren't typed on the wire: list items sent into "elements" would be invisible
    // to the map API but still stored. Yjs keeps list content in `_start`.
    if ((elements as unknown as { _start: unknown })._start !== null) return false

    const ids = new Set<string>()
    let rootChanged = false
    // `changed` lists the types that existed before the transaction and changed in it; content
    // inside a type created in it is covered by its parent's entry. Each one belongs to the
    // Element it sits in (the child of the root map it's nested under).
    for (const [type, keys] of transactions.flatMap((t) => [...t.changed])) {
      if ((type as unknown) === elements) {
        rootChanged = true
        for (const key of keys) if (key !== null) ids.add(key)
        continue
      }
      let item = type._item
      while (item && item.parent !== elements) item = (item.parent as Y.AbstractType<unknown>)._item
      if (item?.parentSub) ids.add(item.parentSub)
    }
    if (rootChanged && elements.size > this.elementCap) return false
    for (const id of ids) {
      const fields = elements.get(id)
      if (fields === undefined) continue // deleted
      if (!(fields instanceof Y.Map) || !readElement(fields)) return false
    }
    return true
  }

  private shadowDoc() {
    if (this.shadow) return this.shadow
    const shadow = new Y.Doc()
    // Created as a map up front, so an update can't introduce "elements" as another type.
    shadow.getMap(ELEMENTS)
    Y.applyUpdate(shadow, Y.encodeStateAsUpdate(this.doc))
    this.shadow = shadow
    this.doc.on("update", this.follow)
    return shadow
  }

  private drop() {
    if (!this.shadow) return
    this.doc.off("update", this.follow)
    this.shadow.destroy()
    this.shadow = null
  }
}
