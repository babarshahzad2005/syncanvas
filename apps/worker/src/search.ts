import { type Role, SEARCH_MIN_LENGTH, type SearchResult } from "@syncanvas/shared"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import type { Database } from "./db/client"
import { boardSearch, boards, memberships } from "./db/schema"

// Search (M5b ticket 05; FLOWS "Search"): the caller's own Boards (never one they aren't a
// Member of, never Trash) whose title or text matches, title matches first.

/** At most this many results; there's no results page, only the dropdown. */
const LIMIT = 10
/** At most this many words of a query are used. */
const MAX_WORDS = 8

/**
 * The query as Postgres search terms: each word a prefix, so results follow the typing
 * ("roadm" finds "roadmap"), all of them required. Only letters and digits get through, so
 * nothing in it is tsquery syntax. Null when there's nothing to look for.
 */
export function searchTerms(q: string): string | null {
  if (q.trim().length < SEARCH_MIN_LENGTH) return null
  const words = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_WORDS)
  return words.length > 0 ? words.map((w) => `${w}:*`).join(" & ") : null
}

export async function search(db: Database, userId: string, q: string): Promise<SearchResult[]> {
  const terms = searchTerms(q)
  if (!terms) return []
  const query = sql`to_tsquery('english', ${terms})`
  const titleHit = sql<boolean>`coalesce(${boards.titleTsv} @@ ${query}, false)`
  const bodyHit = sql<boolean>`coalesce(${boardSearch.tsv} @@ ${query}, false)`
  const ranked = await db
    .select({
      id: boards.id,
      title: boards.title,
      role: memberships.role,
      updatedAt: boards.updatedAt,
      bodyHit,
    })
    .from(memberships)
    .innerJoin(boards, eq(boards.id, memberships.boardId))
    .leftJoin(boardSearch, eq(boardSearch.boardId, boards.id))
    .where(
      and(
        eq(memberships.userId, userId),
        isNull(boards.deletedAt),
        sql`(${titleHit} or ${bodyHit})`,
      ),
    )
    .orderBy(
      desc(titleHit),
      desc(
        sql`coalesce(ts_rank(${boards.titleTsv}, ${query}), 0) + coalesce(ts_rank(${boardSearch.tsv}, ${query}), 0)`,
      ),
      desc(boards.updatedAt),
    )
    .limit(LIMIT)
  // Snippets only for the few Boards shown: ts_headline reads the whole text.
  const withText = ranked.filter((r) => r.bodyHit).map((r) => r.id)
  const snippets = new Map<string, string>()
  if (withText.length > 0) {
    const rows = await db
      .select({
        boardId: boardSearch.boardId,
        snippet: sql<string>`ts_headline('english', ${boardSearch.body}, ${query}, 'StartSel=' || chr(2) || ', StopSel=' || chr(3) || ', MaxWords=16, MinWords=6, MaxFragments=1')`,
      })
      .from(boardSearch)
      .where(inArray(boardSearch.boardId, withText))
    for (const row of rows) snippets.set(row.boardId, row.snippet.replace(/\s+/g, " ").trim())
  }
  return ranked.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: snippets.get(r.id) ?? null,
    role: r.role as Role,
    updatedAt: r.updatedAt.toISOString(),
  }))
}
