import { IndexeddbPersistence } from "y-indexeddb"
import type * as Y from "yjs"

// The local copy of each Board (FLOWS §2): an IndexedDB database per Board, so a Board opened
// before renders instantly and edits made offline survive until they're synced.

const PREFIX = "syncanvas-board-"

export function openLocalCopy(boardId: string, doc: Y.Doc): IndexeddbPersistence | null {
  try {
    return new IndexeddbPersistence(`${PREFIX}${boardId}`, doc)
  } catch {
    // IndexedDB can be unavailable (some private modes); the Board still works online.
    return null
  }
}

/** Removes one Board's local copy (after leaving it); waits for open handles to close. */
export function clearLocalCopy(boardId: string) {
  try {
    indexedDB.deleteDatabase(`${PREFIX}${boardId}`)
  } catch {
    // IndexedDB unavailable: nothing was saved.
  }
}

/** Removes every saved Board on this device, e.g. on sign-out. */
export async function clearAllLocalCopies() {
  try {
    const databases = await indexedDB.databases()
    await Promise.all(
      databases
        .filter((db) => db.name?.startsWith(PREFIX))
        .map(
          (db) =>
            new Promise<void>((resolve) => {
              const request = indexedDB.deleteDatabase(db.name as string)
              request.onsuccess = request.onerror = request.onblocked = () => resolve()
            }),
        ),
    )
  } catch {
    // Nothing to clear, or IndexedDB unavailable.
  }
}
