import type * as Y from "yjs"
import { toYMap } from "./clipboard"
import { type ElementWithId, elementsOf, listElements } from "./model"

// ---------- Restoring a Version (M5b ticket 07; FLOWS "Restore a Version") ----------
//
// A restore runs in the restorer's client: it compares the Board as it is now with the
// Version, and writes the difference as one ordinary transaction. Everyone gets it as a normal
// update, the board room checks it like any other, and Ctrl+Z undoes it in one step.

export type RestoreDiff = {
  /** In the Version but not on the Board now. */
  added: ElementWithId[]
  /** On both, but different now (replaced whole by the Version's). */
  changed: ElementWithId[]
  /** On the Board now but not in the Version. */
  removed: string[]
}

/** A stable text form of an Element, to tell whether two copies differ. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

/** What turns the Board `current` into the Version `version`. Invalid entries are ignored. */
export function restoreDiff(current: Y.Doc, version: Y.Doc): RestoreDiff {
  const now = new Map(listElements(current).map((e) => [e.id, e]))
  const then = listElements(version)
  const kept = new Set(then.map((e) => e.id))
  const added: ElementWithId[] = []
  const changed: ElementWithId[] = []
  for (const e of then) {
    const existing = now.get(e.id)
    if (!existing) added.push(e)
    else if (canonical(existing) !== canonical(e)) changed.push(e)
  }
  return { added, changed, removed: [...now.keys()].filter((id) => !kept.has(id)) }
}

/**
 * Makes the Board `doc` look like the Version, as one transaction tagged `origin` (one undo
 * step). Elements keep their ids, so connectors, groups, Threads, and image keys line up.
 * Returns the diff it applied.
 */
export function applyRestore(doc: Y.Doc, version: Y.Doc, origin: unknown): RestoreDiff {
  const diff = restoreDiff(doc, version)
  const elements = elementsOf(doc)
  doc.transact(() => {
    for (const id of diff.removed) elements.delete(id)
    for (const { id, ...fields } of [...diff.added, ...diff.changed]) {
      elements.set(id, toYMap(fields as Record<string, unknown>))
    }
  }, origin)
  return diff
}
