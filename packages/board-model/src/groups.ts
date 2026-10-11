import type { ElementWithId } from "./model"

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
