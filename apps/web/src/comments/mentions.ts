import { MENTION_PATTERN, type MentionView } from "@syncanvas/shared"

// Mentions while typing (M4 ticket 03). The box shows "@Name"; what's saved is `<@userId>`
// for every name picked from the Member list. Names typed by hand stay plain text.

/** Picked Mentions: the name as shown in the box → the User id. */
export type Picked = ReadonlyMap<string, string>

/** The text to save: each picked "@Name" becomes `<@id>` (longest names first). */
export function toStored(text: string, picked: Picked): string {
  let out = text
  const byLength = [...picked].sort(([a], [b]) => b.length - a.length)
  for (const [name, id] of byLength) out = out.split(`@${name}`).join(`<@${id}>`)
  return out
}

/** A saved comment, back in the box for editing: Members as picked "@Name", others plain. */
export function toEditable(
  body: string,
  mentions: readonly MentionView[],
): { text: string; picked: Map<string, string> } {
  const picked = new Map<string, string>()
  const text = body.replace(MENTION_PATTERN, (_, id: string) => {
    const view = mentions.find((m) => m.id === id)
    if (view?.member) picked.set(view.name, id)
    return `@${view?.name ?? "someone"}`
  })
  return { text, picked }
}

/** The "@query" being typed just before the caret, if any: where it starts, and the query. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /(^|\s)@([^\s@]{0,40})$/u.exec(before)
  if (!match) return null
  const query = match[2] ?? ""
  return { start: before.length - query.length - 1, query }
}

/** Members whose name or email starts a word with the query, best first, up to 6. */
export function suggestions<T extends { name: string; email: string }>(
  members: readonly T[],
  query: string,
): T[] {
  const q = query.toLocaleLowerCase()
  const score = (m: T) => {
    const name = m.name.toLocaleLowerCase()
    if (name.startsWith(q)) return 0
    if (name.split(/\s+/).some((w) => w.startsWith(q))) return 1
    if (m.email.toLocaleLowerCase().startsWith(q)) return 2
    return -1
  }
  return members
    .map((m) => ({ m, s: score(m) }))
    .filter(({ s }) => s >= 0)
    .sort((a, b) => a.s - b.s || a.m.name.localeCompare(b.m.name))
    .slice(0, 6)
    .map(({ m }) => m)
}
