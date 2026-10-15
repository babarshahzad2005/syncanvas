// Whether this device holds edits a Board's room never received (M3 ticket 05): set when you
// edit while not connected, cleared once a sync completes. Kept in localStorage so a reload
// while offline remembers it. If access is gone by the time we reconnect, those edits can
// never be saved, so the person is offered a picture of them before the copy is cleared.

const key = (boardId: string) => `syncanvas-unsynced-${boardId}`

/** Remembers unsynced edits on a Board, with its title for the explanation later. */
export function markUnsynced(boardId: string, title: string | null) {
  try {
    if (localStorage.getItem(key(boardId)) === null || title) {
      localStorage.setItem(key(boardId), JSON.stringify({ title }))
    }
  } catch {
    // Storage blocked: the picture just won't be offered.
  }
}

export function clearUnsynced(boardId: string) {
  try {
    localStorage.removeItem(key(boardId))
  } catch {
    // Nothing to clear.
  }
}

/** The unsynced edits' record, or null if everything reached the room. */
export function unsyncedOf(boardId: string): { title: string | null } | null {
  try {
    const raw = localStorage.getItem(key(boardId))
    return raw === null ? null : (JSON.parse(raw) as { title: string | null })
  } catch {
    return null
  }
}
