import type * as Y from "yjs"
import { type ElementWithId, elementsOf } from "./model"

// ---------- Groups (GLOSSARY: Group) ----------
//
// A group is the set of Elements sharing a `groupId`. Groups are flat (no nesting), and a
// groupId held by fewer than 2 existing Elements counts as no group: when members are
// deleted down to one, the group dissolves without anyone having to write anything.

/** Every live group (2+ existing members): groupId → member ids. */
export function liveGroups(elements: readonly ElementWithId[]): Map<string, string[]> {
  const byGroup = new Map<string, string[]>()
  for (const element of elements) {
    if (element.groupId === undefined) continue
    const members = byGroup.get(element.groupId)
    if (members) members.push(element.id)
    else byGroup.set(element.groupId, [element.id])
  }
  for (const [groupId, members] of byGroup) {
    if (members.length < 2) byGroup.delete(groupId)
  }
  return byGroup
}

/** Ids of the members of `groupId`, or [] if it isn't a live group. */
export function groupMembers(elements: readonly ElementWithId[], groupId: string): string[] {
  return liveGroups(elements).get(groupId) ?? []
}

/** The Element's group, or undefined if it has none or its group has dissolved. */
export function effectiveGroupId(
  element: ElementWithId,
  elements: readonly ElementWithId[],
): string | undefined {
  if (element.groupId === undefined) return undefined
  return groupMembers(elements, element.groupId).length >= 2 ? element.groupId : undefined
}

/** Expands ids to include every member of their live groups (selecting a member selects the group). */
export function expandToGroups(
  ids: Iterable<string>,
  elements: readonly ElementWithId[],
): Set<string> {
  const groups = liveGroups(elements)
  const groupOf = new Map(elements.map((e) => [e.id, e.groupId]))
  const out = new Set<string>()
  for (const id of ids) {
    out.add(id)
    const groupId = groupOf.get(id)
    const members = groupId === undefined ? undefined : groups.get(groupId)
    if (members) for (const member of members) out.add(member)
  }
  return out
}

// ---------- Writing groups and Lock ----------

/**
 * Removes the `groupId` of each Element whose group has dissolved (fewer than 2 existing
 * members). Called inside the transaction of every local write that touches those Elements
 * (spec: stale groupIds are cleaned up on the next local write that touches them).
 */
export function cleanStaleGroups(doc: Y.Doc, ids: Iterable<string>) {
  const elements = elementsOf(doc)
  const grouped: [Y.Map<unknown>, string][] = []
  for (const id of ids) {
    const fields = elements.get(id)
    const groupId = fields?.get("groupId")
    if (fields && typeof groupId === "string") grouped.push([fields, groupId])
  }
  if (grouped.length === 0) return // the usual case: nothing to count
  const wanted = new Set(grouped.map(([, groupId]) => groupId))
  const counts = new Map<string, number>()
  for (const fields of elements.values()) {
    const groupId = fields.get("groupId")
    if (typeof groupId === "string" && wanted.has(groupId)) {
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1)
    }
  }
  for (const [fields, groupId] of grouped) {
    if ((counts.get(groupId) ?? 0) < 2) fields.delete("groupId")
  }
}

/**
 * Groups Elements into one new flat group (no nesting: members of other groups move into
 * it). Returns the new groupId, or null for fewer than 2 existing Elements.
 */
export function groupElements(doc: Y.Doc, ids: Iterable<string>, origin: unknown): string | null {
  const elements = elementsOf(doc)
  const members = [...new Set(ids)].filter((id) => elements.has(id))
  if (members.length < 2) return null
  const groupId = crypto.randomUUID()
  const before = new Set(members.map((id) => elements.get(id)?.get("groupId")))
  doc.transact(() => {
    for (const id of members) elements.get(id)?.set("groupId", groupId)
    // Groups merged away may have left a lone member behind.
    const leftBehind = [...elements].flatMap(([id, fields]) =>
      before.has(fields.get("groupId")) ? [id] : [],
    )
    cleanStaleGroups(doc, leftBehind)
  }, origin)
  return groupId
}

/** Takes Elements out of their groups. */
export function ungroupElements(doc: Y.Doc, ids: Iterable<string>, origin: unknown) {
  const elements = elementsOf(doc)
  doc.transact(() => {
    for (const id of ids) elements.get(id)?.delete("groupId")
  }, origin)
}

/** Locks or unlocks Elements. Unlocked Elements carry no `locked` field at all. */
export function setLocked(doc: Y.Doc, ids: Iterable<string>, locked: boolean, origin: unknown) {
  const elements = elementsOf(doc)
  ids = [...ids]
  doc.transact(() => {
    for (const id of ids) {
      const fields = elements.get(id)
      if (!fields) continue
      if (locked) fields.set("locked", true)
      else fields.delete("locked")
    }
    cleanStaleGroups(doc, ids)
  }, origin)
}
