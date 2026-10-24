// The busy fallback picture (M6 ticket 07; DESIGN.md → Busy fallback picture): a Guest or an
// Embed viewer turned away by a full Board sees its latest dashboard thumbnail. They hold a
// board token even while turned away (it's fetched before the socket), so they can read it.
// No React here: the Embed viewer uses it too.

/** How often the picture is fetched again while waiting (the busy retry's own pace). */
export const BUSY_PICTURE_REFRESH_MS = 30_000

/**
 * The Board's latest picture as an object URL (revoke it when done), or null when it has
 * none yet or the token no longer works.
 */
export async function fetchBoardPicture(boardId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/assets/thumbs/${encodeURIComponent(boardId)}`, {
      credentials: "omit",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (!res.ok) return null
    return URL.createObjectURL(await res.blob())
  } catch {
    return null
  }
}
