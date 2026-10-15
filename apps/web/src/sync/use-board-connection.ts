import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import type { IndexeddbPersistence } from "y-indexeddb"
import * as Y from "yjs"
import { BoardConnection, type ConnectionStatus } from "./board-connection"
import { openLocalCopy } from "./local-copy"
import { clearUnsynced, markUnsynced, unsyncedOf } from "./unsynced"

/**
 * One live connection per mounted Board screen, plus its local copy in IndexedDB. Created
 * inside the effect, so React's development double-mount and switching Boards each get a
 * fresh doc, socket, and local copy.
 */
export function useBoardConnection(boardId: string, guestLink?: string) {
  const [connection, setConnection] = useState<BoardConnection | null>(null)
  // Bumped to start over with a fresh doc after the board room refused this copy's edits.
  const [generation, setGeneration] = useState(0)
  // Access is gone, but this device holds edits the room never got (M3 ticket 05): the copy
  // waits until the person has had the chance to save a picture of it.
  const [lostWork, setLostWork] = useState<{ title: string | null } | null>(null)
  const localRef = useRef<IndexeddbPersistence | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new generation starts over
  useEffect(() => {
    const doc = new Y.Doc()
    // Start loading the local copy and connecting at the same time; whichever arrives first
    // renders first, and Yjs merges the two. Guests keep nothing on the device (M3 ticket 04).
    const local = guestLink ? null : openLocalCopy(boardId, doc)
    localRef.current = local
    const c = new BoardConnection(boardId, doc, { guestLink })

    // Your own edits made while not connected (not the local copy loading, not the room's).
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (!local || origin === local || origin === c) return
      if (c.status !== "online") markUnsynced(boardId, c.board?.title ?? null)
    }
    doc.on("update", onUpdate)

    const unsubscribe = c.subscribe(() => {
      if (c.status === "online") clearUnsynced(boardId)
      // Access is gone: the local copy must not outlive it (FLOWS §2 "Go offline and reconnect"),
      // unless it holds work the room never received; then it waits for `discardLocalCopy`.
      if (c.status === "revoked" && local) {
        const unsynced = unsyncedOf(boardId)
        if (unsynced) setLostWork({ title: unsynced.title ?? c.board?.title ?? null })
        else void local.clearData()
      }
      // Downgraded with edits the board room refused (M3 ticket 02): they can never be
      // saved, so drop the local copy and load the Board again as it is on the server.
      if (c.status === "resync") {
        unsubscribe()
        toast("Some of your changes weren't saved", {
          description: "You can only view this board now.",
        })
        clearUnsynced(boardId)
        void local?.clearData().then(() => setGeneration((g) => g + 1))
      }
    })
    c.start()
    setConnection(c)
    return () => {
      unsubscribe()
      doc.off("update", onUpdate)
      c.stop()
      void local?.destroy()
      doc.destroy()
    }
  }, [boardId, guestLink, generation])

  /** Clears the local copy kept for a picture after access was lost (M3 ticket 05). */
  const discardLocalCopy = useCallback(async () => {
    await localRef.current?.clearData()
    clearUnsynced(boardId)
    setLostWork(null)
  }, [boardId])

  const subscribe = useCallback(
    (listener: () => void) => connection?.subscribe(listener) ?? (() => {}),
    [connection],
  )
  const status: ConnectionStatus = useSyncExternalStore(
    subscribe,
    () => connection?.status ?? "connecting",
  )
  // The Role can change while connected (M3 ticket 02), so it's read as a snapshot too.
  const role = useSyncExternalStore(subscribe, () => connection?.role ?? null)
  return {
    connection,
    doc: connection?.doc ?? null,
    status,
    board: connection?.board ?? null,
    role,
    lostWork,
    discardLocalCopy,
  }
}
